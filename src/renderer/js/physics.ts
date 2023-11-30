import * as Three from 'three'

// @ts-ignore
import Ammo from '../vendor/ammo/ammo.wasm.js'

import { assert } from './util'

export class PhysicsScene {
	private initialized = false
	private ammo: ReturnType<typeof Ammo>

	private collisionConfiguration: Ammo.btDefaultCollisionConfiguration
	private dispatcher: Ammo.btCollisionDispatcher
	private overlappingPairCache: Ammo.btDbvtBroadphase
	private solver: Ammo.btSequentialImpulseConstraintSolver

	private dynamicsWorld: Ammo.btDiscreteDynamicsWorld

	//private threeObjects = new Set<Three.Object3D>()
	threeGroup

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
		this.dynamicsWorld.setGravity(new this.ammo.btVector3(0, -10, 0))

		let ground = this.createBox({
			position: new Three.Vector3(0, -20, 0),
			size: new Three.Vector3(20, 2, 20),
			mass: 0,
		})

		ground.mesh.material.color.setHex(0xff0000)

		/* let box = this.createBox({
			position: new Three.Vector3(0, 10, 0),
			size: new Three.Vector3(10, 10, 10),
			mass: 1,
		}) */

		for (let y = 0; y < 20; y++) {
			let x = Math.random() * 10 - 5
			let z = Math.random() * 10 - 5
			let box = this.createBox({
				position: new Three.Vector3(x, y, z),
				size: new Three.Vector3(1, 1, 1),
				mass: 1,
			})
		}

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
		transform.setIdentity()
		transform.setOrigin(
			new this.ammo.btVector3(position.x, position.y, position.z),
		)
		let motionState = new this.ammo.btDefaultMotionState(transform)

		let shape = new this.ammo.btBoxShape(
			new this.ammo.btVector3(size.x / 2, size.y / 2, size.z / 2),
		)
		shape.calculateLocalInertia(mass, localInertia)

		let rbInfo = new this.ammo.btRigidBodyConstructionInfo(
			mass,
			motionState,
			shape,
			localInertia,
		)
		let body = new this.ammo.btRigidBody(rbInfo)

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
		let body = three.userData.physicsBody
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
		}
	}
}
