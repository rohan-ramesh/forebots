import '../css/index.scss'

import React from 'react'
import ReactDOM from 'react-dom/client'
import * as B from '@blueprintjs/core'
import * as Three from 'three'

import { assert, clamp, unwrap } from './util'
import { PhysicsScene } from './physics'
import { Cave } from './cavegen'

// TODO
class Hierarchy extends React.Component {
	render() {
		return 'I am hhierarchy'
	}
}

class Inspector extends React.Component {
	render() {
		return 'I am inspector'
	}
}

class Timeline extends React.Component {
	render() {
		return 'I am timeline'
	}
}

type MainViewState = {
	uiShown: boolean
	hierarchyShown: boolean
	inspectorShown: boolean
	timelineShown: boolean

	fpsAvg: number
	fpsLow: number

	settings: {
		useArtificialKeyups: boolean
	}
}

class MainView extends React.Component<{}, MainViewState> {
	canvasRef: React.RefObject<HTMLCanvasElement>
	clickthroughRef: React.RefObject<HTMLDivElement>

	canvas: HTMLCanvasElement | null = null
	three: {
		scene: Three.Scene
		camera: Three.Camera
		renderer: Three.Renderer
	} | null = null

	light: Three.PointLight | null = null

	cave: Cave | null = null

	keydownEvent: ((e: KeyboardEvent) => void) | null = null
	keyupEvent: ((e: KeyboardEvent) => void) | null = null
	mouseDownEvent: ((e: MouseEvent) => void) | null = null
	mouseUpEvent: ((e: MouseEvent) => void) | null = null
	mouseMoveEvent: ((e: MouseEvent) => void) | null = null
	focusEvent: ((e: FocusEvent) => void) | null = null
	blurEvent: ((e: FocusEvent) => void) | null = null
	scrollEvent: ((e: WheelEvent) => void) | null = null
	windowResizeEvent: (() => void) | null = null

	keysPressed: Set<string> = new Set()
	artificialKeyups: { [key: string]: ReturnType<typeof setTimeout> } = {}

	physicsScene: PhysicsScene | null = null
	prevTime: number = 0

	dragStart: { x: number; y: number } | null = null
	cameraRotStart: { x: number; y: number } | null = null

	fpsMeasures: number[] = []
	fpsMeasureTime: number = 0

	constructor(props: {}) {
		super(props)
		this.state = {
			uiShown: true,
			hierarchyShown: true,
			inspectorShown: true,
			timelineShown: true,

			fpsAvg: 0,
			fpsLow: 0,

			settings: {
				useArtificialKeyups: false,
			},
		}

		this.canvasRef = React.createRef()
		this.clickthroughRef = React.createRef()
	}

	render() {
		return (
			<>
				<canvas className="canvas" ref={this.canvasRef} />
				{!this.state.uiShown && (
					<B.Button
						className="show-ui"
						onClick={() => this.setState({ uiShown: true })}
						minimal={true}
					>
						<kbd>Tab</kbd>
						<span>Show UI</span>
					</B.Button>
				)}
				<div
					className={`
						overlay
						ui-${this.state.uiShown ? 'shown' : 'hidden'}
						hierarchy-${this.state.hierarchyShown ? 'shown' : 'hidden'}
						inspector-${this.state.inspectorShown ? 'shown' : 'hidden'}
						timeline-${this.state.timelineShown ? 'shown' : 'hidden'}
					`}
				>
					<div className="toolbar">
						<B.ButtonGroup>
							<B.Button icon="play" />
							<B.Button icon="pause" />
							<B.Button icon="stop" />
							<B.Button icon="step-forward" />
							<B.Button icon="step-backward" />
							<B.Button icon="fast-forward" />
							<B.Button icon="fast-backward" />
						</B.ButtonGroup>
						<div className="fill" />
						<B.ButtonGroup>
							<B.Popover
								interactionKind="click"
								position="bottom-right"
								content={
									<B.Menu className="settings-popover">
										<B.MenuItem
											text={
												<>
													<B.Text>Use artificial keyups</B.Text>
													<B.Text className="small">
														Artificial keyups are used to prevent keys from
														getting stuck when the window loses focus, or for
														keyboards that do not support NKRO.
													</B.Text>
												</>
											}
											multiline={true}
											icon={
												this.state.settings.useArtificialKeyups
													? 'tick'
													: 'blank'
											}
											onClick={() =>
												this.setState({
													settings: {
														...this.state.settings,
														useArtificialKeyups:
															!this.state.settings.useArtificialKeyups,
													},
												})
											}
											shouldDismissPopover={false}
										/>
									</B.Menu>
								}
								renderTarget={({ isOpen, ...targetProps }) => (
									<B.Button {...targetProps} icon="cog" active={isOpen} />
								)}
							/>
						</B.ButtonGroup>
						<B.Text>
							FPS: 1s avg{' '}
							<span className={this.state.fpsAvg < 20 ? 'bad' : ''}>
								{this.state.fpsAvg.toFixed(1)}
							</span>
							, low{' '}
							<span className={this.state.fpsLow < 20 ? 'bad' : ''}>
								{this.state.fpsLow.toFixed(1)}
							</span>
						</B.Text>
					</div>
					<div className="hierarchy">
						<div className="title">
							<span>Hierarchy</span>
						</div>
						<B.Button
							className="toggle"
							onClick={() =>
								this.setState({
									hierarchyShown: !this.state.hierarchyShown,
								})
							}
							icon={
								this.state.hierarchyShown ? 'chevron-left' : 'chevron-right'
							}
							title={
								this.state.hierarchyShown ? 'Hide Hierarchy' : 'Show Hierarchy'
							}
							minimal={true}
						/>
						{this.state.hierarchyShown && (
							<div className="body">
								<Hierarchy />
							</div>
						)}
					</div>
					<div className="clickthrough" ref={this.clickthroughRef}></div>
					<div className="inspector">
						<div className="title">
							<span>Inspector</span>
						</div>
						<B.Button
							className="toggle"
							onClick={() =>
								this.setState({
									inspectorShown: !this.state.inspectorShown,
								})
							}
							icon={
								this.state.inspectorShown ? 'chevron-right' : 'chevron-left'
							}
							title={
								this.state.inspectorShown ? 'Hide Inspector' : 'Show Inspector'
							}
							minimal={true}
						/>
						{this.state.inspectorShown && (
							<div className="body">
								<Inspector />
							</div>
						)}
					</div>
					<div className="timeline">
						<div className="title">
							<span>Timeline</span>
						</div>
						<B.Button
							className="toggle"
							onClick={() =>
								this.setState({
									timelineShown: !this.state.timelineShown,
								})
							}
							icon={this.state.timelineShown ? 'chevron-down' : 'chevron-up'}
							title={
								this.state.timelineShown ? 'Hide Timeline' : 'Show Timeline'
							}
							minimal={true}
						/>
						{this.state.timelineShown && (
							<div className="body">
								<Timeline />
							</div>
						)}
					</div>
				</div>
			</>
		)
	}

	async componentDidMount() {
		this.canvas = unwrap(this.canvasRef.current)
		let scene = new Three.Scene()
		let camera = new Three.PerspectiveCamera(
			75,
			this.canvas.clientWidth / this.canvas.clientHeight,
			0.1,
			1000,
		)
		let renderer = new Three.WebGLRenderer({ canvas: this.canvas })
		renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight)
		this.three = { scene, camera, renderer }

		// Cyan background
		scene.background = new Three.Color(0x00ffff)
		scene.add(new Three.AmbientLight(0x404040))

		this.light = new Three.PointLight(0xffffff, 300)
		this.light.position.set(0, 1, 0)
		scene.add(this.light)

		this.physicsScene = new PhysicsScene(this.three)
		await this.physicsScene.init()

		this.cave = new Cave()
		let chunk = this.cave.getChunk(0, 0, 0)
		let material = new Three.MeshPhongMaterial({ color: 0x00ff00 })
		let mesh = new Three.Mesh(chunk.geom, material)

		scene.add(mesh)

		this.keydownEvent = (e) => {
			if (e.code === 'Tab') {
				this.setState({ uiShown: !this.state.uiShown })
			}
			let now = performance.now()

			this.keysPressed.add(e.code)
			if (this.artificialKeyups[e.code]) {
				clearTimeout(this.artificialKeyups[e.code])
				delete this.artificialKeyups[e.code]
			}
			this.artificialKeyups[e.code] = setTimeout(() => {
				if (!this.state.settings.useArtificialKeyups) {
					return
				}
				this.keysPressed.delete(e.code)
				delete this.artificialKeyups[e.code]
			}, 1000)
		}
		document.addEventListener('keydown', this.keydownEvent)

		this.keyupEvent = (e) => {
			if (this.artificialKeyups[e.code]) {
				clearTimeout(this.artificialKeyups[e.code])
				delete this.artificialKeyups[e.code]
			}
			this.keysPressed.delete(e.code)
		}
		document.addEventListener('keyup', this.keyupEvent)

		this.mouseDownEvent = (e) => {
			if (e.target !== this.clickthroughRef.current) {
				return
			}
			e.preventDefault()
			if (e.button === 0) {
				this.cameraRotStart = { x: e.clientX, y: e.clientY }
			}
		}
		document.addEventListener('mousedown', this.mouseDownEvent)

		this.mouseUpEvent = (e) => {
			if (e.button === 0) {
				this.cameraRotStart = null
			}
		}
		document.addEventListener('mouseup', this.mouseUpEvent)

		this.mouseMoveEvent = (e) => {
			if (this.cameraRotStart) {
				let { x, y } = this.cameraRotStart
				let dx = e.clientX - x
				let dy = e.clientY - y
				if (this.three) {
					let rot = this.three.camera.rotation
					rot.order = 'YXZ'
					rot.y -= dx * 0.002
					rot.x = clamp(rot.x - dy * 0.002, -Math.PI / 2, Math.PI / 2)
				}
				this.cameraRotStart = { x: e.clientX, y: e.clientY }
			}
		}
		document.addEventListener('mousemove', this.mouseMoveEvent)

		this.focusEvent = (e) => {
			// pass
		}
		window.addEventListener('focus', this.focusEvent)

		this.blurEvent = (e) => {
			this.keysPressed.clear()
			this.cameraRotStart = null
		}
		window.addEventListener('blur', this.blurEvent)

		this.scrollEvent = (e) => {
			if (this.three) {
				let facing = this.three.camera.getWorldDirection(new Three.Vector3())
				this.three.camera.position.addScaledVector(facing, e.deltaY * 0.01)
			}
		}
		document.addEventListener('wheel', this.scrollEvent)

		this.windowResizeEvent = () => {
			let { clientWidth, clientHeight } = document.documentElement
			camera.aspect = clientWidth / clientHeight
			camera.updateProjectionMatrix()
			renderer.setSize(clientWidth, clientHeight)
		}
		window.addEventListener('resize', this.windowResizeEvent)

		this.renderFrame()
	}

	componentWillUnmount() {
		if (this.keydownEvent) {
			document.removeEventListener('keydown', this.keydownEvent)
		}
		if (this.keyupEvent) {
			document.removeEventListener('keyup', this.keyupEvent)
		}
		if (this.mouseDownEvent) {
			document.removeEventListener('mousedown', this.mouseDownEvent)
		}
		if (this.mouseUpEvent) {
			document.removeEventListener('mouseup', this.mouseUpEvent)
		}
		if (this.mouseMoveEvent) {
			document.removeEventListener('mousemove', this.mouseMoveEvent)
		}
		if (this.focusEvent) {
			window.removeEventListener('focus', this.focusEvent)
		}
		if (this.blurEvent) {
			window.removeEventListener('blur', this.blurEvent)
		}
		if (this.scrollEvent) {
			document.removeEventListener('wheel', this.scrollEvent)
		}
		if (this.windowResizeEvent) {
			window.removeEventListener('resize', this.windowResizeEvent)
		}
	}

	renderFrame() {
		//console.log(this.keysPressed)

		let now = performance.now()
		let deltaMs = now - this.prevTime
		this.prevTime = now

		this.fpsMeasures.push(1000 / deltaMs)
		this.fpsMeasureTime += deltaMs
		while (this.fpsMeasureTime > 1000 && this.fpsMeasures.length > 1) {
			this.fpsMeasureTime -= 1000 / unwrap(this.fpsMeasures.shift())
		}
		this.setState({
			fpsAvg:
				this.fpsMeasures.reduce((a, b) => a + b, 0) / this.fpsMeasures.length,
			fpsLow: Math.min(...this.fpsMeasures),
		})

		requestAnimationFrame(() => this.renderFrame())
		if (!this.three || !this.physicsScene) {
			return
		}
		this.physicsScene.update()

		let dist = 0.01 * deltaMs
		if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].some((k) => this.keysPressed.has(k))) {
			let facing = this.three.camera.getWorldDirection(new Three.Vector3())
			facing.y = 0
			facing.normalize()
			let right = new Three.Vector3()
			right.crossVectors(facing, new Three.Vector3(0, 1, 0))
			let dir = new Three.Vector3(
				Number(this.keysPressed.has('KeyD')) -
					Number(this.keysPressed.has('KeyA')),
				0,
				Number(this.keysPressed.has('KeyS')) -
					Number(this.keysPressed.has('KeyW')),
			)
			dir.normalize()
			dir.applyAxisAngle(
				new Three.Vector3(0, 1, 0),
				this.three.camera.rotation.y,
			)
			dir.multiplyScalar(dist)
			this.three.camera.position.add(dir)
		}
		/* if (
			this.keysPressed.has('ShiftLeft') ||
			this.keysPressed.has('ShiftRight')
		) {
			this.three.camera.position.y -= dist
		} else if (this.keysPressed.has('Space')) {
			this.three.camera.position.y += dist
		} */
		let dy =
			Number(this.keysPressed.has('Space')) -
			Number(
				this.keysPressed.has('ShiftLeft') || this.keysPressed.has('ShiftRight'),
			)
		this.three.camera.position.y += dy * dist

		let cameraPos = this.three.camera.position.clone()
		let cameraUp = this.three.camera.up.clone()
		cameraUp.normalize()
		cameraPos.addScaledVector(cameraUp, 2)
		this.light?.position.copy(cameraPos)

		this.three.renderer.render(this.three.scene, this.three.camera)
	}
}

ReactDOM.createRoot(document.getElementById('root')!).render(<MainView />)