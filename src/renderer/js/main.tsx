import '../css/index.scss'

import React from 'react'
import ReactDOM from 'react-dom/client'
import * as B from '@blueprintjs/core'
import * as Three from 'three'

import * as ThreeAddons from 'three/examples/jsm/Addons.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'

import { assert, basename, clamp, sizeToString, unwrap } from './util'
import { PhysicsScene } from './physics'
import { Cave } from './cavegen'

import '../../preload/types.d.ts'

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

	currentDatabase: 'unknown' | { path: string } | null
	databaseSize: number
}

class MainView extends React.Component<{}, MainViewState> {
	canvasRef: React.RefObject<HTMLCanvasElement>
	clickthroughRef: React.RefObject<HTMLDivElement>

	canvas: HTMLCanvasElement | null = null
	three: {
		scene: Three.Scene
		camera: Three.PerspectiveCamera
		renderer: Three.Renderer
		composer: ThreeAddons.EffectComposer
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

	updateDatabaseSizeInterval: ReturnType<typeof setInterval> | null = null

	isLoading: boolean = false
	caveObjects: Three.Object3D[] = []

	glowScene: Three.Scene | null = null
	mainCanvas: HTMLCanvasElement | null = null
	mainRenderer: Three.Renderer | null = null
	glowCanvas: HTMLCanvasElement | null = null
	glowRenderer: Three.Renderer | null = null
	glowEffectActive: boolean = false
	glowMat: Three.ShaderMaterial | null = null

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

			currentDatabase: 'unknown',
			databaseSize: 0,
		}

		this.canvasRef = React.createRef()
		this.clickthroughRef = React.createRef()
	}

	render() {
		let saveAs =
			!this.state.currentDatabase ||
			this.keysPressed.has('ControlLeft') ||
			this.keysPressed.has('ControlRight')

		// prettier-ignore
		let databasePathStylized =
			this.state.currentDatabase === 'unknown' ? <i>Loading...</i> :
			this.state.currentDatabase === null ? <i>In-memory database</i> :
			basename(this.state.currentDatabase.path)

		let fileOperations = (
			<B.ButtonGroup>
				<B.Button
					icon="folder-open"
					title="Open"
					onClick={async () => {
						this.isLoading = true
						let confirmation = confirm(
							'Are you sure you want to close the current database? All ' +
								'unsaved changes will be lost.',
						)
						if (!confirmation) {
							return
						}

						let file = await window.electronAPI.openFile()
						if (!file) {
							return
						}
						await window.electronAPI.openDatabase(file)
						this.setState({
							currentDatabase: { path: file },
						})
						this.loadCave()
						this.isLoading = false
					}}
				/>
				<B.Button
					icon="cross"
					title={this.state.currentDatabase ? 'Close' : ''}
					onClick={async () => {
						this.isLoading = true
						if (!this.state.currentDatabase) {
							return
						}
						let confirmation = confirm(
							'Are you sure you want to close the current database? All ' +
								'unsaved changes will be lost.',
						)
						if (!confirmation) {
							return
						}

						await window.electronAPI.closeDatabase()
						assert((await window.electronAPI.currentDatabase()) === undefined)
						this.setState({
							currentDatabase: null,
						})
						this.loadCave()
						this.isLoading = false
					}}
					disabled={this.state.currentDatabase === null}
				>
					<div className="multiline">
						<p>{databasePathStylized}</p>
						<p className="small-inline">
							{sizeToString(this.state.databaseSize)}
						</p>
					</div>
				</B.Button>
				<B.Button
					icon={saveAs ? 'download' : 'floppy-disk'}
					title={saveAs ? 'Save As' : 'Save'}
					onClick={async () => {
						this.isLoading = true
						if (saveAs) {
							let result = await window.electronAPI.saveDatabaseAs()
							if (!result.canceled) {
								this.setState({
									currentDatabase: { path: unwrap(result.path) },
								})
							}
						} else {
							await window.electronAPI.saveDatabase()
						}
						this.isLoading = false
					}}
				/>
			</B.ButtonGroup>
		)

		return (
			<>
				<canvas tabIndex={0} className="canvas" ref={this.canvasRef} />
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
						{fileOperations}
						<B.ButtonGroup>
							<B.Button icon="step-backward" />
							<B.Button icon="play" />
							<B.Button icon="pause" />
							<B.Button icon="step-forward" />
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
						<B.Text className="fps-counter">
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
					<div
						tabIndex={0}
						className="clickthrough"
						ref={this.clickthroughRef}
					></div>
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

	async loadCave() {
		let { scene, camera, renderer } = unwrap(this.three)
		for (let obj of this.caveObjects) {
			scene.remove(obj)
		}

		this.cave = await Cave.init()
		let chunk = await this.cave.getChunk(0, 0, 0)
		let material = new Three.MeshPhongMaterial({ color: 0x00ff00 })
		chunk.geom.computeVertexNormals()
		let mesh = new Three.Mesh(chunk.geom, material)
		this.caveObjects.push(mesh)
		scene.add(mesh)
	}

	async componentDidMount() {
		this.setState({
			currentDatabase: await window.electronAPI
				.currentDatabase()
				.then((path) => {
					if (path) {
						return { path }
					} else {
						return null
					}
				}),
		})

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

		let composer = new ThreeAddons.EffectComposer(
			renderer,
			new Three.WebGLRenderTarget(
				this.canvas.clientWidth,
				this.canvas.clientHeight,
				{
					stencilBuffer: true,
				},
			),
		)
		composer.addPass(new RenderPass(scene, camera))

		this.three = { scene, camera, renderer, composer }

		this.loadCave()

		// Cyan background
		scene.background = new Three.Color(0x000080)
		scene.add(new Three.AmbientLight(0x404040))

		this.light = new Three.PointLight(0xffffff, 300)
		this.light.position.set(0, 1, 0)
		scene.add(this.light)

		this.physicsScene = new PhysicsScene(this.three)
		await this.physicsScene.init()

		//camera.position.set(24, 24, 48)
		camera.position.set(0, -10, 10)
		camera.rotation.order = 'YXZ'
		camera.rotation.x = -Math.PI / 4

		this.keydownEvent = (e) => {
			if (
				document.activeElement === this.clickthroughRef.current ||
				document.activeElement === this.canvas
			) {
				e.preventDefault()
			}

			if (e.code === 'Tab') {
				this.setState({ uiShown: !this.state.uiShown })
			}
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
			if (
				e.target !== this.clickthroughRef.current &&
				e.target !== this.canvas
			) {
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

		this.initializeGlow()

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

			if (!this.three || !this.canvas || !this.physicsScene) {
				return
			}
			let mousePos = new Three.Vector2(
				(2 * e.clientX) / this.canvas.clientWidth - 1,
				(-2 * e.clientY) / this.canvas.clientHeight + 1,
			)
			let raycaster = new Three.Raycaster()
			raycaster.setFromCamera(mousePos, this.three.camera)
			let intersects = raycaster.intersectObjects(
				this.physicsScene.threeGroup.children,
			)
			if (intersects.length > 0) {
				let obj = intersects[0].object

				// Copy object onto temp scene so we can render it as a glow effect
				let tempObj = obj.clone()
				// @ts-ignore: For some reason the DT types lack this property
				tempObj.material = new Three.MeshBasicMaterial({
					color: 0xffffff,
				})
				assert(this.glowScene)
				this.glowScene.children = []
				this.glowScene.add(tempObj)
				this.glowEffectActive = true
			} else {
				this.glowEffectActive = false
			}
		}
		document.addEventListener('mousemove', this.mouseMoveEvent)
		document.addEventListener('mouseenter', this.mouseMoveEvent)
		document.addEventListener('mouseleave', this.mouseMoveEvent)

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
				this.three.camera.position.addScaledVector(facing, e.deltaY * -0.01)
			}
		}
		document.addEventListener('wheel', this.scrollEvent)

		this.windowResizeEvent = () => {
			let { clientWidth, clientHeight } = document.documentElement
			camera.aspect = clientWidth / clientHeight
			camera.updateProjectionMatrix()
			renderer.setSize(clientWidth, clientHeight)
			composer.setSize(clientWidth, clientHeight)
			this.mainRenderer?.setSize(clientWidth, clientHeight)
			this.glowRenderer?.setSize(clientWidth, clientHeight)
			this.glowMat?.uniforms.resolution.value.set(clientWidth, clientHeight)
		}
		window.addEventListener('resize', this.windowResizeEvent)

		this.updateDatabaseSizeInterval = setInterval(
			async () => await this.updateDatabaseSize(),
			1000,
		)

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
			document.removeEventListener('mouseenter', this.mouseMoveEvent)
			document.removeEventListener('mouseleave', this.mouseMoveEvent)
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

		if (this.updateDatabaseSizeInterval) {
			clearInterval(this.updateDatabaseSizeInterval)
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
		if (!this.three || !this.physicsScene || this.isLoading) {
			return
		}
		this.physicsScene.update()

		let dist = 0.01 * deltaMs
		if (
			this.keysPressed.has('ControlLeft') ||
			this.keysPressed.has('ControlRight')
		) {
			dist *= 3
		}
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

		//this.three.renderer.render(this.three.scene, this.three.camera)
		//this.three.composer.render()
		this.compositeScene()
	}

	async updateDatabaseSize() {
		let size = await window.electronAPI.getDatabaseSize()
		this.setState({
			databaseSize: size,
		})
	}

	initializeGlow() {
		assert(this.canvas)

		this.glowScene = new Three.Scene()
		this.glowScene.background = new Three.Color(0x000000)

		this.mainCanvas = document.createElement('canvas')
		this.mainRenderer = new Three.WebGLRenderer({
			alpha: true,
			canvas: this.mainCanvas,
		})
		this.mainRenderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight)

		this.glowCanvas = document.createElement('canvas')
		this.glowRenderer = new Three.WebGLRenderer({
			alpha: true,
			canvas: this.glowCanvas,
		})
		this.glowRenderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight)

		this.glowEffectActive = false
		this.glowMat = new Three.ShaderMaterial({
			uniforms: {
				glowColor: { value: new Three.Color(0x00ffff) },
				baseTex: { value: null },
				maskTex: { value: null },
				resolution: {
					value: new Three.Vector2(
						this.canvas.clientWidth,
						this.canvas.clientHeight,
					),
				},
			},
			fragmentShader: `
				uniform vec3 glowColor;
				uniform sampler2D baseTex;
				uniform sampler2D maskTex;
				uniform vec2 resolution;

				void main() {
					float glow = 0.0;
					if (texture2D(maskTex, gl_FragCoord.xy / resolution.xy).x == 0.0) {
						for (int x = -3; x <= 3; x++) {
							for (int y = -3; y <= 3; y++) {
								vec2 offset = vec2(float(x), float(y)) / resolution;
								glow += texture2D(
									maskTex, gl_FragCoord.xy / resolution + offset
								).x;
							}
						}
					}
					gl_FragColor = vec4(
						texture2D(baseTex, gl_FragCoord.xy / resolution.xy).xyz +
							vec3(glow), 1.0
					);
				}
			`,
		})

		unwrap(this.three).composer.passes = [
			new ThreeAddons.ShaderPass(this.glowMat),
			new ThreeAddons.OutputPass(),
		]
	}

	compositeScene() {
		let { scene, camera, composer } = unwrap(this.three)
		assert(
			this.glowScene &&
				this.glowRenderer &&
				this.glowMat &&
				this.glowCanvas &&
				this.mainRenderer &&
				this.mainCanvas,
		)

		if (this.glowEffectActive) {
			this.glowRenderer.render(this.glowScene, camera)
			this.glowMat.uniforms.maskTex.value = new Three.Texture(this.glowCanvas)
			this.glowMat.uniforms.maskTex.value.needsUpdate = true
		} else {
			this.glowMat.uniforms.maskTex.value = null
		}

		this.mainRenderer.render(scene, camera)
		this.glowMat.uniforms.baseTex.value = new Three.Texture(this.mainCanvas)
		this.glowMat.uniforms.baseTex.value.needsUpdate = true

		// Composite the result onto the main scene
		composer.render()
	}
}

ReactDOM.createRoot(document.getElementById('root')!).render(<MainView />)
