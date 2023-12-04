import '../css/index.scss'
import '../css/logic-viewer.scss'

import React from 'react'
import ReactDOM from 'react-dom/client'
import * as B from '@blueprintjs/core'

import { CanaryLogic } from './logic/canary'
import { SerialDevice } from './logic'
import { EventEmitter, assert } from './util'
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
	gyroscope: { x: number; y: number; z: number }
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
		data: { x: number; y: number; z: number }
	}>
	implements SerialDevice<never, { x: number; y: number; z: number }>
{
	constructor(
		private options: {
			get: () => { x: number; y: number; z: number }
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
			gyroscope: { x: 0, y: 0, z: 0 },
			radio: [],
			radioDraft: '',
		}
	}

	componentDidMount() {
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

		let gyroscope = new Gyroscope({
			get: () => this.state.gyroscope,
		})

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
				<ul>
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

		let wheelMotors = (
			<B.Card>
				<B.H3>Wheel Motors</B.H3>
				<ul className="four">
					{Object.entries(this.state.wheelMotors).map(([name, motor], i) => (
						<li key={i}>
							Wheel {name}:{' '}
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
						([name, motor], i) => (
							<li key={i}>
								Hip {name}:{' '}
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
						([name, motor], i) => (
							<li key={i}>
								Knee {name}:{' '}
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

		let gyroscope = (
			<B.Card>
				<B.H3>Gyroscope</B.H3>
				<ul className="gyro">
					{(['x', 'y', 'z'] as const).map((axis, i) => (
						<li key={i}>
							{axis.toUpperCase()}:{' '}
							<B.Slider
								min={-45}
								max={45}
								value={this.state.gyroscope[axis]}
								onChange={(value) => {
									this.setState((state) => {
										state.gyroscope[axis] = value
										return state
									})
								}}
								labelStepSize={45}
							/>
						</li>
					))}
				</ul>
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
		}

		let radio = (
			<B.Card className="radio">
				<B.H3 className="heading">Radio</B.H3>
				<B.Card className="history">
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
				{groundSensors}
				{wheelMotors}
				{hipServos}
				{kneeServos}
				{gyroscope}
				{radio}
				{alarmState}
			</div>
		)
	}
}

ReactDOM.createRoot(document.getElementById('root')!).render(<LogicViewer />)
