import { EventEmitter } from '../util'

/**
 *
 */
export interface ILogic {}

export interface SerialDevice<Send, Receive>
	extends EventEmitter<{
		data: Receive
		/* connect: void
		disconnect: void */
	}> {
	send(data: Send): void
	connected(): boolean
}
