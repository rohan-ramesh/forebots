import '../css/index.scss'
import '../css/logic-viewer.scss'

import React from 'react'
import ReactDOM from 'react-dom/client'
import * as B from '@blueprintjs/core'
import * as Three from 'three'
import { GLTFLoader } from 'three/examples/jsm/Addons.js'

import { CanaryLogic } from './logic/canary'
import { SerialDevice } from './logic'
import { EventEmitter, assert, clamp, cubicEaseInOut, unwrap } from './util'
import { emergencyBeep, warningBeep } from './sound'

const CORNERS = ['frontLeft', 'frontRight', 'backLeft', 'backRight'] as const

type EachCorner<T> = {
	frontLeft: T
	frontRight: T
	backLeft: T
	backRight: T
}

function arrayToCorners<T>(array: T[]): EachCorner<T> {
	assert(array.length === 4)
	return Object.fromEntries(
		CORNERS.map((corner, i) => [corner, array[i]]),
	) as EachCorner<T>
}

function cornersToArray<T>(corners: EachCorner<T>): T[] {
	return CORNERS.map((corner) => corners[corner])
}

type LogicViewerState = {
	alarmState: 'warning' | 'emergency' | 'none'
	alarmSilenced: boolean
	environmentSensors: {
		type: 'temperature' | 'co' | 'h2s' | 'co2' | 'empty' | 'disconnected'
		value: number
	}[]
	groundSensors: boolean[]
	wheelMotors: EachCorner<number>
	jointServos: {
		hip: EachCorner<number>
		knee: EachCorner<number>
	}
	gyroscope: {
		current: { theta: number; phi: number }
		target: { theta: number; phi: number }
	}
	radio: {
		message: string
		party: 'user' | 'robot'
	}[]
	radioDraft: string
}

class EnvironmentSensor
	extends EventEmitter<{
		data: string
	}>
	implements SerialDevice<string, string>
{
	constructor(
		private options: {
			getKind: () => string
			getValue: () => number
		},
	) {
		super()
	}

	send(data: string) {
		// Their send, our receive
		this.onReceive(data)
	}

	onReceive(data: string) {
		if (this.options.getKind() === 'disconnected') {
			return
		}
		if (data === 'kind') {
			this.emit('data', this.options.getKind())
		}
		if (data === 'read') {
			this.emit('data', this.options.getValue().toString())
		}
	}

	connected() {
		return this.options.getKind() !== 'disconnected'
	}
}

class GroundSensor
	extends EventEmitter<{
		data: boolean
	}>
	implements SerialDevice<never, boolean>
{
	constructor(
		private options: {
			get: () => boolean
		},
	) {
		super()
		setInterval(() => {
			this.emit('data', this.options.get())
		}, 10)
	}

	send(data: never) {}

	connected() {
		return true
	}
}

class Motor
	extends EventEmitter<{
		data: never
		receive: number
	}>
	implements SerialDevice<number, never>
{
	constructor() {
		super()
	}

	send(data: number) {
		// Their send, our receive
		this.emit('receive', data)
	}

	connected() {
		return true
	}
}

class Gyroscope
	extends EventEmitter<{
		data: { theta: number; phi: number }
	}>
	implements SerialDevice<never, { theta: number; phi: number }>
{
	constructor(
		private options: {
			get: () => { theta: number; phi: number }
		},
	) {
		super()
		setInterval(() => {
			this.emit('data', this.options.get())
		}, 10)
	}

	send(data: never) {}

	connected() {
		return true
	}
}

class Radio
	extends EventEmitter<{
		/**
		 * Do not listen to this event!
		 * @see receive
		 */
		data: string

		/**
		 * Listen to this event instead of `data`.
		 * @see data
		 */
		receive: string
	}>
	implements SerialDevice<string, string>
{
	constructor() {
		super()
	}

	/**
	 * Do not call this method! It is called by an implementation of ILogic that
	 * requires a radio interface. Call `sendToClient` instead.
	 * @see sendToClient
	 */
	send(data: string) {
		// Their send, our receive
		this.emit('receive', data)
	}

	/**
	 * Send data to the instance of a class implementing ILogic. Use this method
	 * instead of `send`.
	 * @see send
	 */
	sendToClient(data: string) {
		// Our send, their receive
		this.emit('data', data)
	}

	connected() {
		return true
	}
}

class Bell
	extends EventEmitter<{
		data: never
		receive: 'warning' | 'emergency' | 'none'
	}>
	implements SerialDevice<{ kind: 'warning' | 'emergency' | 'none' }, never>
{
	constructor() {
		super()
	}

	send(data: { kind: 'warning' | 'emergency' | 'none' }) {
		// Their send, our receive
		this.emit('receive', data.kind)
	}

	connected() {
		return true
	}
}

function sensorIdentToName(
	ident: LogicViewerState['environmentSensors'][0]['type'],
) {
	// prettier-ignore
	return {
		temperature: 'Temperature (K)',
		co: 'CO (ppb)',
		h2s: <>H<sub>2</sub>S (ppb)</>,
		co2: <>CO<sub>2</sub> (ppb)</>,
		empty: 'Empty',
		disconnected: 'Disconnected',
	}[ident]
}

const DEFAULT_LEVELS = {
	temperature: 298.15,
	co: 35_000,
	h2s: 20_000,
	co2: 5_000_000,
}

class LogicViewer extends React.Component<{}, LogicViewerState> {
	canary?: CanaryLogic
	radio?: Radio

	currentBeep:
		| ReturnType<typeof warningBeep>
		| ReturnType<typeof emergencyBeep>
		| null = null

	gyroCanvas: HTMLCanvasElement | null = null
	gyroCanvasRef: React.RefObject<HTMLCanvasElement> = React.createRef()
	gyroThree: {
		scene: Three.Scene
		camera: Three.Camera
		renderer: Three.Renderer
	} | null = null
	gyroObjects: {
		currentArrow: Three.Group
		targetArrow: Three.Group
		pointLight: Three.PointLight
	} | null = null
	gyroVelocity: THREE.Quaternion = new Three.Quaternion()

	botPreview: HTMLCanvasElement | null = null
	botPreviewRef: React.RefObject<HTMLCanvasElement> = React.createRef()
	botPreviewThree: {
		scene: Three.Scene
		camera: Three.Camera
		renderer: Three.Renderer
	} | null = null
	botPreviewObjects: {
		hierarchy: Three.Group
		pointLight: Three.PointLight
	} | null = null

	botPreviewLastUpdate: number = 0
	botPreviewLastPanned: number = 0
	botPreviewMouseStart: { x: number; y: number } | null = null
	botPreviewZoomDistance: number = 0

	rendering: boolean = false

	radioRef: React.RefObject<HTMLDivElement> = React.createRef()
	radioScroll: boolean = false

	constructor(props: {}) {
		super(props)

		const generateCorners = () =>
			Object.fromEntries(
				CORNERS.map((corner) => [corner, 0]),
			) as EachCorner<number>

		this.state = {
			alarmState: 'none',
			alarmSilenced: false,
			environmentSensors: [
				{ type: 'temperature', value: DEFAULT_LEVELS.temperature },
				{ type: 'co', value: DEFAULT_LEVELS.co },
				{ type: 'empty', value: 0 },
				{ type: 'empty', value: 0 },
				{ type: 'empty', value: 0 },
				{ type: 'empty', value: 0 },
			],
			groundSensors: [true, true, true, true],
			wheelMotors: generateCorners(),
			jointServos: {
				hip: generateCorners(),
				knee: generateCorners(),
			},
			gyroscope: {
				current: { theta: 0, phi: 0 },
				target: { theta: 0, phi: 0 },
			},
			radio: [],
			radioDraft: '',
		}
	}

	componentDidMount() {
		this.rendering = true

		let environmentSensors = []
		for (let i = 0; i < 6; i++) {
			environmentSensors.push(
				new EnvironmentSensor({
					getKind: () => this.state.environmentSensors[i].type,
					getValue: () => this.state.environmentSensors[i].value,
				}),
			)
		}

		let groundSensors = {
			frontLeft: new GroundSensor({
				get: () => this.state.groundSensors[0],
			}),
			frontRight: new GroundSensor({
				get: () => this.state.groundSensors[1],
			}),
			backLeft: new GroundSensor({
				get: () => this.state.groundSensors[2],
			}),
			backRight: new GroundSensor({
				get: () => this.state.groundSensors[3],
			}),
		}

		const generateCorners = (
			getRoot: (state: LogicViewerState) => EachCorner<number>,
		) => {
			let corners: Partial<EachCorner<Motor>> = {}
			for (let corner of CORNERS) {
				let motor = new Motor()
				motor.on('receive', (value) => {
					this.setState((state) => {
						let root = getRoot(state)
						root[corner] = value
						return state
					})
				})
				corners[corner] = motor
			}
			return corners as EachCorner<Motor>
		}

		let wheelMotors = generateCorners((state) => state.wheelMotors)
		let hipServos = generateCorners((state) => state.jointServos.hip)
		let kneeServos = generateCorners((state) => state.jointServos.knee)

		this.initBotPreview()

		let gyroscope = new Gyroscope({
			get: () => this.state.gyroscope.current,
		})

		this.initGyroVisual()

		this.radio = new Radio()
		this.radio.on('receive', (message) => {
			this.setState((state) => {
				if (state.radio.length >= 100) {
					state.radio.shift()
				}
				state.radio.push({
					message,
					party: 'robot',
				})
				return state
			})
			this.radioScroll = true
		})

		let bell = new Bell()
		bell.on('receive', (state) => {
			this.setState({
				alarmState: state,
				alarmSilenced: false,
			})
			if (this.currentBeep) {
				this.currentBeep.stop()
			}
			if (state === 'warning') {
				this.currentBeep = warningBeep()
			} else if (state === 'emergency') {
				this.currentBeep = emergencyBeep()
			} else {
				this.currentBeep = null
			}
		})

		this.canary = new CanaryLogic({
			environmentSensors,
			groundSensors,
			wheelMotors,
			jointServos: {
				hip: hipServos,
				knee: kneeServos,
			},
			gyroscope,
			radio: this.radio,
			bell,
		})

		this.canary.spinUp()
	}

	render() {
		let environmentMenu = (i: number) => (
			<B.Menu>
				{(
					['temperature', 'co', 'h2s', 'co2', 'empty', 'disconnected'] as const
				).map((type) => (
					<>
						{type === 'empty' ? <B.MenuDivider /> : null}
						<B.MenuItem
							key={type}
							onClick={() => {
								this.setState((state) => {
									state.environmentSensors[i].type = type
									state.environmentSensors[i].value =
										type === 'empty' || type === 'disconnected'
											? 0
											: DEFAULT_LEVELS[type]
									return state
								})
							}}
							text={sensorIdentToName(type)}
						/>
					</>
				))}
			</B.Menu>
		)

		let environmentSensors = (
			<B.Card>
				<B.H3>Environment Sensors</B.H3>
				<ul>
					{this.state.environmentSensors.map((sensor, i) => (
						<li key={i}>
							<B.ControlGroup>
								<B.Popover content={environmentMenu(i)} placement="bottom">
									<B.Button
										alignText="left"
										rightIcon="caret-down"
										className="dropdown-button"
									>
										{sensorIdentToName(sensor.type)}
									</B.Button>
								</B.Popover>
								<B.NumericInput
									min={0}
									max={100_000_000}
									minorStepSize={
										sensor.type === 'temperature' ? 0.01 : undefined
									}
									value={sensor.value}
									onValueChange={(value) => {
										this.setState((state) => {
											state.environmentSensors[i].value = value
											return state
										})
									}}
									disabled={
										sensor.type === 'empty' || sensor.type === 'disconnected'
									}
								/>
							</B.ControlGroup>
						</li>
					))}
				</ul>
			</B.Card>
		)

		let groundSensors = (
			<B.Card>
				<B.H3>Ground Sensors</B.H3>
				<ul className="four compact">
					{this.state.groundSensors.map((sensor, i) => (
						<li key={i}>
							<B.Switch
								checked={sensor}
								onChange={(event) => {
									this.setState((state) => {
										state.groundSensors[i] = !state.groundSensors[i]
										return state
									})
								}}
							>
								{sensor ? 'On' : 'Off'}:{' '}
								{['Front Left', 'Front Right', 'Back Left', 'Back Right'][i]}
							</B.Switch>
						</li>
					))}
				</ul>
			</B.Card>
		)

		const NAMES = {
			frontLeft: 'Front Left',
			frontRight: 'Front Right',
			backLeft: 'Back Left',
			backRight: 'Back Right',
		} as const

		let wheelMotors = (
			<B.Card>
				<B.H3>Wheel Motors</B.H3>
				<ul className="four">
					{Object.entries(this.state.wheelMotors).map(([ident, motor], i) => (
						<li key={i}>
							Wheel {NAMES[ident as keyof typeof NAMES]}:{' '}
							<B.Slider
								min={-100}
								max={100}
								value={motor}
								disabled={true}
								labelStepSize={25}
							/>
						</li>
					))}
				</ul>
			</B.Card>
		)

		let hipServos = (
			<B.Card>
				<B.H3>Hip Servos</B.H3>
				<ul className="four">
					{Object.entries(this.state.jointServos.hip).map(
						([ident, motor], i) => (
							<li key={i}>
								Hip {NAMES[ident as keyof typeof NAMES]}:{' '}
								<B.Slider
									min={-45}
									max={45}
									value={motor}
									disabled={true}
									labelStepSize={25}
								/>
							</li>
						),
					)}
				</ul>
			</B.Card>
		)

		let kneeServos = (
			<B.Card>
				<B.H3>Knee Servos</B.H3>
				<ul className="four">
					{Object.entries(this.state.jointServos.knee).map(
						([ident, motor], i) => (
							<li key={i}>
								Knee {NAMES[ident as keyof typeof NAMES]}:{' '}
								<B.Slider
									min={0}
									max={90}
									value={motor}
									disabled={true}
									labelStepSize={25}
								/>
							</li>
						),
					)}
				</ul>
			</B.Card>
		)

		let botPreview = (
			<B.Card className="bot-preview">
				<B.H3 className="heading">Bot Preview</B.H3>
				<canvas className="visual" ref={this.botPreviewRef} />
			</B.Card>
		)

		let gyroscope = (
			<B.Card className="gyro">
				<B.H3 className="heading">Gyroscope</B.H3>
				<ul className="params">
					{(['theta', 'phi'] as const).map((axis, i) => (
						<li key={i}>
							{axis === 'theta' ? 'θ' : 'φ'}:{' '}
							<B.Slider
								min={-45}
								max={45}
								value={this.state.gyroscope.target[axis]}
								onChange={(value) => {
									this.setState((state) => {
										state.gyroscope.target[axis] = value
										return state
									})
								}}
								labelStepSize={45}
							/>
						</li>
					))}
				</ul>
				<canvas className="visual" ref={this.gyroCanvasRef} />
			</B.Card>
		)

		const radioSend = () => {
			this.setState((state) => {
				if (state.radio.length >= 100) {
					state.radio.shift()
				}
				state.radio.push({
					message: state.radioDraft,
					party: 'user',
				})
				return state
			})
			this.radio!.sendToClient(this.state.radioDraft)
			this.setState({ radioDraft: '' })
			this.radioScroll = true
		}

		let radio = (
			<B.Card className="radio">
				<B.H3 className="heading">Radio</B.H3>
				<B.Card className="history" ref={this.radioRef}>
					{this.state.radio.map((message, i) => (
						<div className={`message ${message.party}`} key={i}>
							<B.Icon icon={message.party === 'user' ? 'person' : 'import'} />
							<span>{message.message}</span>
						</div>
					))}
				</B.Card>
				<B.ControlGroup className="compose">
					<B.InputGroup
						placeholder="Message"
						value={this.state.radioDraft}
						onChange={(event) => {
							this.setState({ radioDraft: event.target.value })
						}}
						onKeyDown={(event) => event.key === 'Enter' && radioSend()}
					/>
					<B.Button
						onClick={() => radioSend()}
						icon="send-message"
						title="Send"
					/>
				</B.ControlGroup>
			</B.Card>
		)

		let alarmState = (
			<B.Card>
				<B.H3>Alarm State</B.H3>
				<div className="alarm-state">
					<div>
						<B.Tag
							large={true}
							minimal={true}
							intent={
								// prettier-ignore
								this.state.alarmSilenced ? 'none' :
								this.state.alarmState === 'warning' ? 'warning' :
								this.state.alarmState === 'emergency' ? 'danger' : 'none'
							}
						>
							{this.state.alarmState}
							{this.state.alarmSilenced ? <i> (silenced)</i> : ''}
						</B.Tag>
					</div>
					<B.Button
						onClick={() => {
							this.setState({ alarmSilenced: true })
							if (this.currentBeep) {
								this.currentBeep.stop()
							}
						}}
						icon="reset"
						title="Silence"
						disabled={
							this.state.alarmState === 'none' || this.state.alarmSilenced
						}
					/>
				</div>
			</B.Card>
		)

		return (
			<div className="logic-viewer">
				{environmentSensors}
				{alarmState}
				{groundSensors}
				{wheelMotors}
				{hipServos}
				{kneeServos}
				{botPreview}
				{gyroscope}
				{radio}
			</div>
		)
	}

	componentDidUpdate() {
		if (this.radioScroll) {
			let radioHistory = this.radioRef.current
			if (radioHistory) {
				radioHistory.scrollTop = radioHistory.scrollHeight
			}
			this.radioScroll = false
		}
	}

	async initBotPreview() {
		this.botPreview = unwrap(this.botPreviewRef.current)
		this.botPreview.width = 450
		this.botPreview.height = 200
		this.botPreviewZoomDistance = 2

		let scene = new Three.Scene()
		let camera = new Three.PerspectiveCamera(45, 450 / 200, 0.1, 1000)
		camera.position.z = this.botPreviewZoomDistance
		let renderer = new Three.WebGLRenderer({ canvas: this.botPreview })
		renderer.setSize(450, 200)

		this.botPreviewThree = { scene, camera, renderer }

		let loader = new GLTFLoader()
		let gltf = await loader.loadAsync('models/canary.glb')
		let model = gltf.scene

		type HierarchySchema = {
			part: string
			tfm?: Three.Vector3
			children?: HierarchySchema[]
			color?: number
		}

		const getLegHierarchy = (
			corner: 'LF' | 'RF' | 'LB' | 'RB',
			color?: number,
		) => {
			let x = {
				LF: -0.23,
				RF: 0.23,
				LB: -0.35,
				RB: 0.35,
			}[corner]
			let z = corner.endsWith('B') ? 0.3 : -0.2

			// prettier-ignore
			return {
				part: `${corner}_Wheel_Leg_Upper`,
				tfm: new Three.Vector3(x, 0.2, z),
				children: [{
					part: `${corner}_Wheel_Leg_Lower`,
					tfm: new Three.Vector3(x, 0, z),
					children: [
						{ part: `${corner}_Wheel_Outer_Cap` },
						{ part: `${corner}_Wheel_Inner_Cap` },
						{ part: `${corner}_Wheel_Outer_Tire` },
						{ part: `${corner}_Wheel_Inner_Tire` },
					],
				}],
				color,
			}
		}

		const SCHEMA: HierarchySchema = {
			part: 'Body',
			children: [
				getLegHierarchy('LF', 0xff0000),
				getLegHierarchy('RF', 0x0000ff),
				getLegHierarchy('LB', 0xffff00),
				getLegHierarchy('RB', 0xff00ff),
			],
			color: 0x00ff00,
		}

		let hierarchy = buildHierarchy(SCHEMA)
		scene.add(hierarchy)

		let pointLight = new Three.PointLight(0xffffff, 100)
		pointLight.position.set(0, 5, 0)
		scene.add(pointLight)

		let ambientLight = new Three.AmbientLight(0x808080)
		scene.add(ambientLight)

		this.botPreviewObjects = {
			hierarchy,
			pointLight,
		}

		this.botPreview.addEventListener('mousedown', (evt) => {
			let bounds = unwrap(this.botPreview).getBoundingClientRect()
			if (evt.button === 0) {
				this.botPreviewMouseStart = {
					x: evt.offsetX - bounds.left,
					y: evt.offsetY - bounds.top,
				}
			}
		})

		document.addEventListener('mouseup', (evt) => {
			if (evt.button === 0) {
				this.botPreviewMouseStart = null
			}
		})

		this.botPreview.addEventListener('mousemove', (evt) => {
			let mouseStart = this.botPreviewMouseStart
			if (!mouseStart) {
				return
			}

			let bounds = unwrap(this.botPreview).getBoundingClientRect()
			let mouseEnd = {
				x: evt.offsetX - bounds.left,
				y: evt.offsetY - bounds.top,
			}

			let rot = camera.rotation
			rot.order = 'YXZ'
			let dx = mouseEnd.x - mouseStart.x
			let dy = mouseEnd.y - mouseStart.y
			rot.y -= dx * 0.02
			rot.x = clamp(rot.x - dy * 0.02, -Math.PI / 2, Math.PI / 2)

			this.botPreviewMouseStart = mouseEnd
		})

		this.botPreview.addEventListener('wheel', (evt) => {
			let delta = evt.deltaY
			this.botPreviewZoomDistance = clamp(
				this.botPreviewZoomDistance - delta * 0.001,
				1,
				3,
			)
		})

		this.updateBotPreview()

		function buildHierarchy(hier: HierarchySchema, color?: number) {
			color = hier.color ?? color
			let part = model.getObjectByName(hier.part)
			if (!part) {
				throw new Error(`Could not find part ${hier.part}`)
			}

			if (color !== undefined) {
				let material = new Three.MeshPhongMaterial({ color })
				if (part instanceof Three.Mesh) {
					part.material = material
				} else {
					console.warn(
						`Part ${hier.part} is not a mesh, so it cannot be colored`,
					)
				}
			}

			let group = new Three.Group()
			group.add(part)
			if (hier.children) {
				for (let child of hier.children) {
					group.add(buildHierarchy(child, color))
				}
			}
			if (hier.tfm) {
				group.position.add(hier.tfm)
				//part.position.sub(hier.tfm)
				for (let child of group.children) {
					child.position.sub(hier.tfm)
				}
			}

			// DEBUG: Show axes
			//group.add(new Three.AxesHelper(0.5))

			return group
		}
	}

	updateBotPreview() {
		if (!this.rendering) {
			return
		}
		requestAnimationFrame(() => this.updateBotPreview())

		let now = performance.now()
		let deltaMs = now - this.botPreviewLastUpdate
		this.botPreviewLastUpdate = now

		if (this.botPreviewMouseStart) {
			this.botPreviewLastPanned = now
		}

		let { scene, camera, renderer } = unwrap(this.botPreviewThree)

		let { hierarchy, pointLight } = unwrap(this.botPreviewObjects)

		let { jointServos } = this.state

		let mapping = {
			LF: 'frontLeft',
			RF: 'frontRight',
			LB: 'backLeft',
			RB: 'backRight',
		} as const

		for (let leg of hierarchy.children) {
			if (!(leg instanceof Three.Group)) {
				continue
			}

			let cornerId = leg.children[0].name.slice(0, 2)
			assert(mapping.hasOwnProperty(cornerId))
			let corner = mapping[cornerId as keyof typeof mapping]

			let hip = jointServos.hip[corner]
			leg.rotation.x = -hip * (Math.PI / 180)

			let knee = jointServos.knee[corner]
			leg.children[1].rotation.x = knee * (Math.PI / 180)
		}

		let rot = camera.rotation

		let sinceLastPanned = now - this.botPreviewLastPanned
		if (sinceLastPanned > 500) {
			let speed = cubicEaseInOut(clamp((sinceLastPanned - 500) / 1000, 0, 1))
			rot.order = 'YXZ'
			rot.y += speed * deltaMs * 0.0002
		}

		let cameraPos = new Three.Vector3(0, 0, this.botPreviewZoomDistance)
		cameraPos.applyEuler(rot)
		camera.position.copy(cameraPos)

		let lightPos = new Three.Vector3(0, 5, 0)
		lightPos.applyEuler(rot)
		pointLight.position.copy(lightPos)

		renderer.render(scene, camera)
	}

	initGyroVisual() {
		this.gyroCanvas = unwrap(this.gyroCanvasRef.current)
		this.gyroCanvas.width = 150
		this.gyroCanvas.height = 150

		let scene = new Three.Scene()
		let camera = new Three.PerspectiveCamera(45, 1, 0.1, 1000)
		camera.position.z = 3
		camera.position.y = 0.5
		let renderer = new Three.WebGLRenderer({ canvas: this.gyroCanvas })
		renderer.setSize(150, 150)

		this.gyroThree = { scene, camera, renderer }

		let currentArrow = createArrow(0x00ff00)
		scene.add(currentArrow)

		let targetArrow = createArrow(0xff0000)
		scene.add(targetArrow)

		let pointLight = new Three.PointLight(0xffffff, 100)
		pointLight.position.set(0, 10, 0)
		scene.add(pointLight)

		let ambientLight = new Three.AmbientLight(0x808080)
		scene.add(ambientLight)

		let neutralPlane = new Three.Group()
		for (let x = 0; x < 5; x++) {
			for (let z = 0; z < 5; z++) {
				let square = new Three.Mesh(
					new Three.PlaneGeometry(0.2, 0.2),
					new Three.MeshPhongMaterial({
						color: (x + z) % 2 === 0 ? 0x808080 : 0x404040,
						side: Three.DoubleSide,
					}),
				)
				square.rotateX(Math.PI / 2)
				square.position.x = (x - 2) * 0.2
				square.position.z = (z - 2) * 0.2
				neutralPlane.add(square)
			}
		}
		scene.add(neutralPlane)

		this.gyroObjects = {
			currentArrow,
			targetArrow,
			pointLight,
		}

		this.updateGyro()

		function createArrow(color: number) {
			let arrow = new Three.Group()

			let lineMat = new Three.LineBasicMaterial({ color })
			let linePoints = [new Three.Vector3(0, 0, 0), new Three.Vector3(0, 1, 0)]
			let lineGeom = new Three.BufferGeometry().setFromPoints(linePoints)
			let line = new Three.Line(lineGeom, lineMat)
			arrow.add(line)

			let coneGeom = new Three.ConeGeometry(0.125, 0.25, 32)
			let coneMat = new Three.MeshPhongMaterial({ color })
			let cone = new Three.Mesh(coneGeom, coneMat)
			cone.position.y = 1
			arrow.add(cone)

			return arrow
		}
	}

	updateGyro() {
		if (!this.rendering) {
			return
		}
		requestAnimationFrame(() => this.updateGyro())

		let { scene, camera, renderer } = unwrap(this.gyroThree)
		let { currentArrow, targetArrow, pointLight } = unwrap(this.gyroObjects)

		let { theta, phi } = this.state.gyroscope.target
		targetArrow.rotation.x = theta * (Math.PI / 180)
		targetArrow.rotation.z = phi * (Math.PI / 180)

		let cameraPos = new Three.Vector3(0, 1, 3)
		cameraPos.applyEuler(targetArrow.rotation)
		camera.position.copy(cameraPos)
		camera.rotation.copy(targetArrow.rotation)

		let pointLightPos = new Three.Vector3(0, 10, 0)
		pointLightPos.applyEuler(targetArrow.rotation)
		pointLight.position.copy(pointLightPos)

		let cur = currentArrow.rotation
		let tgt = targetArrow.rotation

		let curQuat = new Three.Quaternion().setFromEuler(cur)
		let tgtQuat = new Three.Quaternion().setFromEuler(tgt)
		let dist = 2 * Math.acos(Math.abs(curQuat.dot(tgtQuat)))

		let accelQuat = new Three.Quaternion()
			.copy(curQuat)
			.invert()
			.multiply(tgtQuat)
		accelQuat.slerp(new Three.Quaternion(), 0.95 + (1 - Math.sin(dist)) / 20)

		this.gyroVelocity.multiply(accelQuat).slerp(new Three.Quaternion(), 0.05)
		curQuat.multiply(this.gyroVelocity)
		cur.setFromQuaternion(curQuat)

		this.setState((state) => {
			state.gyroscope.current = {
				theta: cur.x * (180 / Math.PI),
				phi: cur.z * (180 / Math.PI),
			}
			return state
		})

		renderer.render(scene, camera)
	}
}

ReactDOM.createRoot(document.getElementById('root')!).render(<LogicViewer />)
