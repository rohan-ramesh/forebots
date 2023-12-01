import * as Three from 'three'
import { GLTFLoader } from 'three/examples/jsm/Addons.js'

// @ts-ignore
import Ammo from '../vendor/ammo/ammo.wasm.js'

import { assert, iterateInChunks, unwrap } from './util'

type ModelList = { [key: string]: ModelMetadata }

type ModelMetadata = {
	densities?: { [key: string]: number }
	constraints: ConstraintData[]
}

type ConstraintData =
	| {
			type: 'hinge'
			rbA: string
			rbB: string
			pivotInA: Three.Vector3
			pivotInB: Three.Vector3
			axisInA: Three.Vector3
			axisInB: Three.Vector3
	  }
	| {
			type: 'point'
			rbA: string
			rbB: string
			pivotInA: Three.Vector3
			pivotInB: Three.Vector3
	  }

export class PhysicsScene {
	private initialized = false
	private ammo: ReturnType<typeof Ammo>

	private collisionConfiguration: Ammo.btDefaultCollisionConfiguration
	private dispatcher: Ammo.btCollisionDispatcher
	private overlappingPairCache: Ammo.btDbvtBroadphase
	private solver: Ammo.btSequentialImpulseConstraintSolver

	private dynamicsWorld: Ammo.btDiscreteDynamicsWorld

	threeGroup

	private models: {
		[key: string]: {
			scene: Three.Object3D
			metadata: ModelMetadata
			properties: {
				partMasses: { [key: string]: number }
			}
		}
	} = {}

	constructor(
		private three: {
			scene: Three.Scene
			camera: Three.Camera
			renderer: Three.Renderer
		},
	) {
		this.threeGroup = new Three.Group()
		this.three.scene.add(this.threeGroup)
	}

	async init() {
		this.ammo = await new Ammo()
		await this.loadModels()

		this.collisionConfiguration =
			new this.ammo.btDefaultCollisionConfiguration()
		this.dispatcher = new this.ammo.btCollisionDispatcher(
			this.collisionConfiguration,
		)
		this.overlappingPairCache = new this.ammo.btDbvtBroadphase()
		this.solver = new this.ammo.btSequentialImpulseConstraintSolver()

		this.dynamicsWorld = new this.ammo.btDiscreteDynamicsWorld(
			this.dispatcher,
			this.overlappingPairCache,
			this.solver,
			this.collisionConfiguration,
		)
		let gravity = new this.ammo.btVector3(0, -10, 0)
		this.dynamicsWorld.setGravity(gravity)
		this.ammo.destroy(gravity)

		let ground = this.createBox({
			position: new Three.Vector3(0, -20, 0),
			size: new Three.Vector3(20, 2, 20),
			mass: 0,
		})

		ground.mesh.material.color.setHex(0xff0000)

		for (let y = 0; y < 20; y++) {
			let x = Math.random() * 10 - 5
			let z = Math.random() * 10 - 5
			let box = this.createBox({
				position: new Three.Vector3(x, y, z),
				size: new Three.Vector3(1, 1, 1),
				mass: 1,
			})
		}

		this.addModel('canary.glb', new Three.Vector3(0, 1, 0))

		this.initialized = true
	}

	update() {
		assert(this.initialized, 'PhysicsScene not initialized')
		this.dynamicsWorld.stepSimulation(1 / 60, 10)

		for (let obj of this.threeGroup.children) {
			this.updateObject(obj)
		}
	}

	createBox(params: {
		position: Three.Vector3
		size: Three.Vector3
		mass: number
	}) {
		let { position, size, mass } = params

		let localInertia = new this.ammo.btVector3(0, 0, 0)

		let transform = new this.ammo.btTransform()
		let transformVec = new this.ammo.btVector3(
			position.x,
			position.y,
			position.z,
		)
		transform.setIdentity()
		transform.setOrigin(transformVec)
		let motionState = new this.ammo.btDefaultMotionState(transform)

		let shapeVec = new this.ammo.btVector3(size.x / 2, size.y / 2, size.z / 2)
		let shape = new this.ammo.btBoxShape(shapeVec)
		shape.calculateLocalInertia(mass, localInertia)

		let rbInfo = new this.ammo.btRigidBodyConstructionInfo(
			mass,
			motionState,
			shape,
			localInertia,
		)
		let body = new this.ammo.btRigidBody(rbInfo)

		this.ammo.destroy(localInertia)
		this.ammo.destroy(transformVec)
		this.ammo.destroy(transform)
		this.ammo.destroy(shapeVec)
		this.ammo.destroy(rbInfo)

		this.dynamicsWorld.addRigidBody(body)

		let mesh = new Three.Mesh(
			new Three.BoxGeometry(size.x, size.y, size.z),
			//new Three.MeshBasicMaterial({ color: 0x00ff00 }),
			new Three.MeshPhongMaterial({ color: 0x00ff00 }),
		)
		mesh.userData.physicsBody = body
		mesh.position.copy(position)
		this.threeGroup.add(mesh)

		return {
			body,
			mesh,
		}
	}

	private updateObject(three: Three.Object3D) {
		assert(three.userData.physicsBody || three.userData.isPhysicsParent)
		if (three.userData.isPhysicsParent) {
			for (let child of three.children) {
				this.updateObject(child)
			}
		}
		let body = three.userData.physicsBody
		if (!body) {
			return
		}

		let motionState = body.getMotionState()
		if (motionState) {
			let transform = new this.ammo.btTransform()
			motionState.getWorldTransform(transform)
			let origin = transform.getOrigin()
			three.position.set(origin.x(), origin.y(), origin.z())
			let rotation = transform.getRotation()
			three.quaternion.set(
				rotation.x(),
				rotation.y(),
				rotation.z(),
				rotation.w(),
			)
			this.ammo.destroy(transform)
		}
	}

	private async loadModels() {
		function canaryGenerateWheelConstraints(
			wheel: 'LF' | 'RF' | 'LB' | 'RB',
		): ConstraintData[] {
			// prettier-ignore
			return [{
				type: 'hinge',
				rbA: 'Body',
				rbB: `${wheel}_Wheel_Leg_Upper`,
				pivotInA: new Three.Vector3(0, 0, 0),
				pivotInB: new Three.Vector3(0, 0, 0),
				axisInA: new Three.Vector3(0, 0, 0),
				axisInB: new Three.Vector3(0, 0, 0),
			}, {
				type: 'hinge',
				rbA: `${wheel}_Wheel_Leg_Upper`,
				rbB: `${wheel}_Wheel_Leg_Lower`,
				pivotInA: new Three.Vector3(0, 0, 0),
				pivotInB: new Three.Vector3(0, 0, 0),
				axisInA: new Three.Vector3(0, 0, 0),
				axisInB: new Three.Vector3(0, 0, 0),
			}, {
				type: 'hinge',
				rbA: `${wheel}_Wheel_Leg_Lower`,
				rbB: `${wheel}_Wheel_Outer_Cap`,
				pivotInA: new Three.Vector3(0, 0, 0),
				pivotInB: new Three.Vector3(0, 0, 0),
				axisInA: new Three.Vector3(0, 0, 0),
				axisInB: new Three.Vector3(0, 0, 0),
			}]
		}

		// prettier-ignore
		const MODELS: ModelList = {
			'canary.glb': {
				constraints: [
					//...canaryGenerateWheelConstraints('LF'),
					//...canaryGenerateWheelConstraints('RF'),
					//...canaryGenerateWheelConstraints('LB'),
					//...canaryGenerateWheelConstraints('RB'),
				],
			},
		}

		this.models = {}
		let loader = new GLTFLoader()
		for (let [model, meta] of Object.entries(MODELS)) {
			let gltf = await loader.loadAsync(`models/${model}`)

			let partMasses: { [key: string]: number } = {}
			for (let child of gltf.scene.children) {
				assert(child instanceof Three.Mesh)
				let volume = calculateVolume(child)
				let density = meta.densities?.[child.name] ?? 1
				let mass = density * volume
				partMasses[child.name] = mass
			}

			gltf.scene.userData.isPhysicsParent = true

			this.models[model] = {
				scene: gltf.scene,
				metadata: meta,
				properties: {
					partMasses,
				},
			}
		}

		/* for (let [name, data] of Object.entries(this.models)) {
			this.addModel(name, data.metadata)
		} */
	}

	addModel(name: string, position: Three.Vector3) {
		let { scene, metadata, properties } = this.models[name]

		for (let child of scene.children) {
			assert(child instanceof Three.Mesh)
			let localInertia = new this.ammo.btVector3(0, 0, 0)

			let adj = child.position.clone().add(position)

			let transform = new this.ammo.btTransform()
			transform.setIdentity()
			let transformVec = new this.ammo.btVector3(adj.x, adj.y, adj.z)
			transform.setOrigin(transformVec)
			let motionState = new this.ammo.btDefaultMotionState(transform)

			let triangleMesh = new this.ammo.btTriangleMesh()
			for (let face of iterateInChunks(
				child.geometry.getAttribute('position').array,
				9,
			)) {
				let a = new this.ammo.btVector3(face[0], face[1], face[2])
				let b = new this.ammo.btVector3(face[3], face[4], face[5])
				let c = new this.ammo.btVector3(face[6], face[7], face[8])
				triangleMesh.addTriangle(a, b, c)

				this.ammo.destroy(a)
				this.ammo.destroy(b)
				this.ammo.destroy(c)
			}

			let shape = new this.ammo.btGImpactMeshShape(triangleMesh)
			shape.updateBound()

			let rbInfo = new this.ammo.btRigidBodyConstructionInfo(
				unwrap(properties.partMasses[child.name]),
				motionState,
				shape,
				localInertia,
			)
			let rb = new this.ammo.btRigidBody(rbInfo)
			child.userData.physicsBody = rb
			this.dynamicsWorld.addRigidBody(rb)

			this.ammo.destroy(localInertia)
			this.ammo.destroy(transformVec)
			this.ammo.destroy(transform)
			this.ammo.destroy(rbInfo)
		}

		for (let constraint of metadata.constraints) {
			let rbA = unwrap(scene.getObjectByName(constraint.rbA))
			let rbB = unwrap(scene.getObjectByName(constraint.rbB))

			if (constraint.type === 'hinge') {
				let pivotInA = constraint.pivotInA
				let pivotInB = constraint.pivotInB
				let axisInA = constraint.axisInA
				let axisInB = constraint.axisInB

				let btPivotInA = new this.ammo.btVector3(
					pivotInA.x,
					pivotInA.y,
					pivotInA.z,
				)
				let btPivotInB = new this.ammo.btVector3(
					pivotInB.x,
					pivotInB.y,
					pivotInB.z,
				)
				let btAxisInA = new this.ammo.btVector3(axisInA.x, axisInA.y, axisInA.z)
				let btAxisInB = new this.ammo.btVector3(axisInB.x, axisInB.y, axisInB.z)

				let hinge = new this.ammo.btHingeConstraint(
					rbA.userData.physicsBody,
					rbB.userData.physicsBody,
					btPivotInA,
					btPivotInB,
					btAxisInA,
					btAxisInB,
				)
				this.dynamicsWorld.addConstraint(hinge)

				this.ammo.destroy(btPivotInA)
				this.ammo.destroy(btPivotInB)
				this.ammo.destroy(btAxisInA)
				this.ammo.destroy(btAxisInB)
			}
			//
			else if (constraint.type === 'point') {
				let pivotInA = constraint.pivotInA
				let pivotInB = constraint.pivotInB

				let btPivotInA = new this.ammo.btVector3(
					pivotInA.x,
					pivotInA.y,
					pivotInA.z,
				)
				let btPivotInB = new this.ammo.btVector3(
					pivotInB.x,
					pivotInB.y,
					pivotInB.z,
				)

				let point = new this.ammo.btPoint2PointConstraint(
					rbA.userData.physicsBody,
					rbB.userData.physicsBody,
					btPivotInA,
					btPivotInB,
				)
				this.dynamicsWorld.addConstraint(point)

				this.ammo.destroy(btPivotInA)
				this.ammo.destroy(btPivotInB)
			}
		}

		this.threeGroup.add(scene)
	}
}

function calculateVolume(three: Three.Mesh): number {
	return 10 // DEBUG

	let volume = 0
	for (let face of iterateInChunks(
		three.geometry.getAttribute('position').array,
		9,
	)) {
		let a = new Three.Vector3(face[0], face[1], face[2])
		let b = new Three.Vector3(face[3], face[4], face[5])
		let c = new Three.Vector3(face[6], face[7], face[8])
		volume += tetraVolume(a, b, c)
	}
	return Math.abs(volume)

	/**
	 * Calculate the signed volume of a tetrahedron with three provided points,
	 * and one point at the origin.
	 */
	function tetraVolume(a: Three.Vector3, b: Three.Vector3, c: Three.Vector3) {
		let v321 = c.x * b.y * a.z
		let v231 = b.x * c.y * a.z
		let v312 = c.x * a.y * b.z
		let v132 = a.x * c.y * b.z
		let v213 = b.x * a.y * c.z
		let v123 = a.x * b.y * c.z
		return (1.0 / 6.0) * (-v321 + v231 + v312 - v132 - v213 + v123)
	}
}
