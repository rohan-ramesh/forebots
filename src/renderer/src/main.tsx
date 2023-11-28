import '../css/index.scss'

import React from 'react'
import ReactDOM from 'react-dom/client'
import * as B from '@blueprintjs/core'
import * as Three from 'three'

import { assert, clamp, unwrap } from './util'
import { PhysicsScene } from './physics'

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

	keydownEvent: ((e: KeyboardEvent) => void) | null = null
	keyupEvent: ((e: KeyboardEvent) => void) | null = null
	mouseDownEvent: ((e: MouseEvent) => void) | null = null
	mouseUpEvent: ((e: MouseEvent) => void) | null = null
	mouseMoveEvent: ((e: MouseEvent) => void) | null = null
	scrollEvent: ((e: WheelEvent) => void) | null = null
	windowResizeEvent: (() => void) | null = null

	keysPressed: Set<string> = new Set()

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

		this.light = new Three.PointLight(0xffffff, 100)
		this.light.position.set(0, 1, 0)
		scene.add(this.light)

		this.physicsScene = new PhysicsScene(this.three)
		await this.physicsScene.init()

		this.keydownEvent = (e) => {
			if (e.key === 'Tab') {
				this.setState({ uiShown: !this.state.uiShown })
			}
			this.keysPressed.add(e.key)
		}
		document.addEventListener('keydown', this.keydownEvent)

		this.keyupEvent = (e) => {
			this.keysPressed.delete(e.key)
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
			console.log(this.cameraRotStart)
			if (this.cameraRotStart) {
				let { x, y } = this.cameraRotStart
				let dx = e.clientX - x
				let dy = e.clientY - y
				if (this.three) {
					let rot = this.three.camera.rotation
					rot.order = 'YXZ'
					rot.y -= dx * 0.002
					rot.x = clamp(rot.x - dy * 0.002, -Math.PI / 2, Math.PI / 2)
					console.log('rot', rot)
				}
				this.cameraRotStart = { x: e.clientX, y: e.clientY }
			}
		}
		document.addEventListener('mousemove', this.mouseMoveEvent)

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
		if (this.windowResizeEvent) {
			window.removeEventListener('resize', this.windowResizeEvent)
		}
	}

	renderFrame() {
		let now = performance.now()
		let deltaMs = now - this.prevTime
		this.prevTime = now

		this.fpsMeasures.push(1000 / deltaMs)
		this.fpsMeasureTime += deltaMs
		while (this.fpsMeasureTime > 1000 && this.fpsMeasures.length > 1) {
			this.fpsMeasureTime -= 1000 / unwrap(this.fpsMeasures.shift())
		}
		console.log(this.fpsMeasures)
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
		if (['w', 'a', 's', 'd'].some((k) => this.keysPressed.has(k))) {
			let facing = this.three.camera.getWorldDirection(new Three.Vector3())
			facing.y = 0
			facing.normalize()
			let right = new Three.Vector3()
			right.crossVectors(facing, new Three.Vector3(0, 1, 0))
			if (this.keysPressed.has('w')) {
				this.three.camera.position.addScaledVector(facing, dist)
			} else if (this.keysPressed.has('s')) {
				this.three.camera.position.addScaledVector(facing, -dist)
			}
			if (this.keysPressed.has('a')) {
				this.three.camera.position.addScaledVector(right, -dist)
			} else if (this.keysPressed.has('d')) {
				this.three.camera.position.addScaledVector(right, dist)
			}
		}
		if (this.keysPressed.has('Shift')) {
			this.three.camera.position.y -= dist
		} else if (this.keysPressed.has(' ')) {
			this.three.camera.position.y += dist
		}

		let cameraPos = this.three.camera.position.clone()
		let cameraUp = this.three.camera.up.clone()
		cameraUp.normalize()
		cameraPos.addScaledVector(cameraUp, 2)
		this.light?.position.copy(cameraPos)

		this.three.renderer.render(this.three.scene, this.three.camera)
	}
}

ReactDOM.createRoot(document.getElementById('root')!).render(<MainView />)
