import '../css/index.scss'

import React from 'react'
import ReactDOM from 'react-dom/client'
import * as B from '@blueprintjs/core'
import * as Three from 'three'

import { assert, unwrap } from './util'

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
}

class MainView extends React.Component<{}, MainViewState> {
	canvasRef: React.RefObject<HTMLCanvasElement>
	canvas: HTMLCanvasElement | null = null
	three: {
		scene: Three.Scene
		camera: Three.Camera
		renderer: Three.Renderer

		cube: Three.Mesh
	} | null = null

	toggleUiEvent: ((e: KeyboardEvent) => void) | null = null
	windowResizeEvent: (() => void) | null = null

	constructor(props: {}) {
		super(props)
		this.state = {
			uiShown: true,
			hierarchyShown: true,
			inspectorShown: true,
			timelineShown: true,
		}

		this.canvasRef = React.createRef()
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

	componentDidMount() {
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

		let geometry = new Three.BoxGeometry(3, 3, 3)
		let material = new Three.MeshBasicMaterial({ color: 0x00ff00 })
		let cube = new Three.Mesh(geometry, material)
		scene.add(cube)
		this.three = { scene, camera, renderer, cube }

		camera.position.z = 5

		this.toggleUiEvent = (e) => {
			if (e.key === 'Tab') {
				this.setState({ uiShown: !this.state.uiShown })
			}
		}
		document.addEventListener('keydown', this.toggleUiEvent)

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
		if (this.toggleUiEvent) {
			document.removeEventListener('keydown', this.toggleUiEvent)
		}
		if (this.windowResizeEvent) {
			window.removeEventListener('resize', this.windowResizeEvent)
		}
	}

	renderFrame() {
		requestAnimationFrame(() => this.renderFrame())
		if (this.three) {
			let { scene, camera, renderer, cube } = this.three
			cube.rotation.x += 0.01
			cube.rotation.y += 0.01
			renderer.render(scene, camera)
		}
	}
}

ReactDOM.createRoot(document.getElementById('root')!).render(<MainView />)
