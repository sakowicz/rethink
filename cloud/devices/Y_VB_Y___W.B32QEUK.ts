import HADevice from './base'
import { Device as Thinq2Device } from '../thinq2/device'
import { type Connection } from '../homeassistant'
import { type Metadata } from '../thinq'
import { allowExtendedType } from '@/util/casting'
import AABBDevice from './aabb_device'
import { ERRORS, STATES, COURSES, TEMPERATURES, SPINS, DOSES } from './washer_common'

// Course codes are model-specific. This appliance's panel calls 0x3a "AI Wash", while the
// shared table maps it to "Bedding" for whichever model that was captured from, so override
// just that entry instead of editing the shared list.
const COURSES_VB: Record<number, string> = { ...COURSES, 0x3a: 'AI Wash' }

const HEADER_LENGTH = 14
const STATUS_LENGTH = 39

export default class Device extends AABBDevice {
    // consecutive frames seen with an empty selection block
    emptyStreak = 0

    constructor(HA: Connection, thinq: Thinq2Device, meta: Metadata) {
        super(HA, thinq)
        this.setConfig(
            allowExtendedType({
                ...HADevice.config(meta, { name: 'LG Washer' }),
                components: {
                    power: {
                        platform: 'switch',
                        unique_id: '$deviceid-power',
                        state_topic: '$this/power',
                        command_topic: '$this/power/set',
                        name: '',
                        icon: 'mdi:washing-machine',
                    },
                    start: {
                        platform: 'button',
                        unique_id: '$deviceid-start',
                        command_topic: '$this/start/set',
                        payload_press: '',
                        name: 'Start',
                        icon: 'mdi:play-circle-outline',
                    },
                    pause: {
                        platform: 'button',
                        unique_id: '$deviceid-pause',
                        command_topic: '$this/pause/set',
                        payload_press: '',
                        name: 'Pause',
                        icon: 'mdi:pause-circle-outline',
                    },
                    status: {
                        platform: 'sensor',
                        unique_id: '$deviceid-status',
                        state_topic: '$this/status',
                        name: 'Status',
                        icon: 'mdi:state-machine',
                        device_class: 'enum',
                        options: STATES.filter((a) => a !== undefined),
                    },
                    error: {
                        platform: 'binary_sensor',
                        unique_id: '$deviceid-error',
                        state_topic: '$this/error',
                        name: 'Error',
                        icon: 'mdi:check-circle',
                        device_class: 'problem',
                        entity_category: 'diagnostic',
                    },
                    error_message: {
                        platform: 'sensor',
                        unique_id: '$deviceid-error-message',
                        state_topic: '$this/error_message',
                        name: 'Error message',
                        icon: 'mdi:alert-circle-outline',
                        device_class: 'enum',
                        entity_category: 'diagnostic',
                        options: ERRORS.filter((a) => a !== undefined),
                    },
                    course: {
                        platform: 'sensor',
                        unique_id: '$deviceid-course',
                        state_topic: '$this/course',
                        name: 'Course',
                        icon: 'mdi:pin-outline',
                    },
                    temp: {
                        platform: 'sensor',
                        unique_id: '$deviceid-temp',
                        state_topic: '$this/temp',
                        name: 'Temperature',
                        device_class: 'temperature',
                        unit_of_measurement: '°C',
                        suggested_display_precision: 0,
                        value_template: "{{ value if value | is_number else 'None' }}",
                    },
                    spin: {
                        platform: 'sensor',
                        unique_id: '$deviceid-spin',
                        state_topic: '$this/spin',
                        name: 'Spin',
                        icon: 'mdi:autorenew',
                        unit_of_measurement: 'RPM',
                        value_template: "{{ value if value | is_number else 'None' }}",
                    },
                    cycles: {
                        platform: 'sensor',
                        unique_id: '$deviceid-cycles',
                        state_topic: '$this/cycles',
                        name: 'Cycle count',
                        icon: 'mdi:counter',
                    },
                    remote_start: {
                        platform: 'binary_sensor',
                        unique_id: '$deviceid-remote_start',
                        state_topic: '$this/remote_start',
                        name: 'Remote start',
                        icon: 'mdi:play-circle-outline',
                    },
                    door_lock: {
                        platform: 'binary_sensor',
                        unique_id: '$deviceid-door_lock',
                        state_topic: '$this/door_lock',
                        name: 'Door lock',
                        device_class: 'lock',
                    },
                    turbowash: {
                        platform: 'binary_sensor',
                        unique_id: '$deviceid-turbowash',
                        state_topic: '$this/turbowash',
                        name: 'TurboWash',
                        icon: 'mdi:speedometer',
                    },
                    prewash: {
                        platform: 'binary_sensor',
                        unique_id: '$deviceid-prewash',
                        state_topic: '$this/prewash',
                        name: 'Pre-wash',
                        icon: 'mdi:water-sync',
                    },
                    steam: {
                        platform: 'binary_sensor',
                        unique_id: '$deviceid-steam',
                        state_topic: '$this/steam',
                        name: 'Steam',
                        icon: 'mdi:weather-dust',
                    },
                    delay_end: {
                        platform: 'sensor',
                        unique_id: '$deviceid-delay_end',
                        state_topic: '$this/delay_end',
                        name: 'Delay end',
                        icon: 'mdi:clock-outline',
                        device_class: 'duration',
                        unit_of_measurement: 'h',
                    },
                    child_lock: {
                        platform: 'binary_sensor',
                        unique_id: '$deviceid-child_lock',
                        state_topic: '$this/child_lock',
                        name: 'Child lock',
                        icon: 'mdi:account-lock',
                    },
                    energy: {
                        platform: 'sensor',
                        unique_id: '$deviceid-energy',
                        state_topic: '$this/energy',
                        name: 'Energy',
                        icon: 'mdi:lightning-bolt',
                        device_class: 'energy',
                        state_class: 'total_increasing',
                        unit_of_measurement: 'Wh',
                    },
                    initial_time: {
                        platform: 'sensor',
                        unique_id: '$deviceid-initial_time',
                        state_topic: '$this/initial_time',
                        device_class: 'duration',
                        unit_of_measurement: 'min',
                        name: 'Initial time',
                    },
                    detergent: {
                        platform: 'sensor',
                        unique_id: '$deviceid-detergent',
                        state_topic: '$this/detergent',
                        name: 'Detergent dose',
                        icon: 'mdi:cup',
                        device_class: 'enum',
                        options: DOSES,
                    },
                    softener: {
                        platform: 'sensor',
                        unique_id: '$deviceid-softener',
                        state_topic: '$this/softener',
                        name: 'Softener dose',
                        icon: 'mdi:cup-outline',
                        device_class: 'enum',
                        options: DOSES,
                    },
                    remaining_time: {
                        platform: 'sensor',
                        unique_id: '$deviceid-remaining_time',
                        state_topic: '$this/remaining_time',
                        device_class: 'duration',
                        unit_of_measurement: 'min',
                        name: 'Remaining time',
                    },
                },
            }),
        )
    }

    start() {
        this.send(Buffer.from('F0ED1121010000001800', 'hex'))
    }

    processAABB(buf: Buffer) {
        if (buf[0] !== 0x20) return

        // A 14-byte header precedes the status block(s): buf[2..3] is the total frame length,
        // buf[10] the record kind and buf[11..12] the payload length. This appliance answers
        // the F0ED status request with a single 0xEB block and then pushes 0xEC frames, which
        // append the previous block as well. The first block is the current state either way.
        if (buf[10] === 0xeb && buf.length === HEADER_LENGTH + STATUS_LENGTH) {
            this.processStatus(buf.subarray(HEADER_LENGTH))
        } else if (buf[10] === 0xec && buf.length === HEADER_LENGTH + STATUS_LENGTH * 2) {
            this.processStatus(buf.subarray(HEADER_LENGTH, HEADER_LENGTH + STATUS_LENGTH))
        }
    }

    processStatus(buf: Buffer) {
        const status = buf[1]
        const time_remain = buf[2] * 60 + buf[3]
        const time_initial = buf[4] * 60 + buf[5]
        const course = buf[6]
        const error = buf[7]
        // Spin sits one byte lower than on the V8 sibling, and temperature follows it.
        // Verified against the panel: Cotton at 800 rpm / 60 C gives buf[9]=5, buf[10]=6, and
        // the six spin positions this machine offers (0/400/800/1000/1200/1400) come out of
        // the shared SPINS table without touching any of its "assumed" entries. buf[11], which
        // the V8 handler reads as temperature, never changes on this firmware.
        const spin = buf[9]
        const temp = buf[10]
        const lock_status = buf[16]
        const cycles = buf[22]
        const energy = buf[33] * 256 + buf[34]
        // ezDispense tank levels, same offsets the F_VB_F___W.B_2QEUK handler uses once its
        // absolute indices are rebased onto the status block.
        const detergent = buf[31]
        const softener = buf[32]
        // Option bits, same positions the F_VB_F___W.B_2QEUK handler uses. Each one was
        // confirmed on its own by the effect it has on the estimated cycle time: 0x01
        // TurboWash shortened it by 28 min, 0x40 pre-wash added 17, 0x80 steam added 51.
        // F_VB_F's 0x08 (eco hybrid) never appears here - that is a dryer option.
        const options = buf[15]
        // Delay is a plain hour count, not a bit. Stepping the panel gave 3 then 4.
        const delay_end = buf[13]

        // The Wi-Fi module stays awake after the panel is switched off and keeps reporting
        // status=1 ("Ready") with the whole selection zeroed, so status>0 on its own made the
        // HA switch snap back to ON right after being turned off. There is no separate power
        // bit: standby is exactly "status 1 with nothing selected".
        //
        // One empty frame is not enough to act on, though. The first reply to the F0ED status
        // request arrives sparse - the clock is populated but course, spin and temperature are
        // not yet - and treating that as standby flipped the switch to OFF on a running
        // machine. Real standby lasts minutes, so wait for a second consecutive empty frame
        // and drop the lone one instead of publishing anything from it.
        const selectionEmpty = status === 1 && course === 0 && spin === 0 && temp === 0
        this.emptyStreak = selectionEmpty ? this.emptyStreak + 1 : 0
        if (selectionEmpty && this.emptyStreak < 2) return

        const powered = status > 0 && !selectionEmpty

        this.publishProperty('power', powered ? 'ON' : 'OFF')
        this.publishProperty('error_message', ERRORS[error] ?? 'unknown') // publish message before set error state
        this.publishProperty('error', error ? 'ON' : 'OFF')
        this.publishProperty('status', powered ? (STATES[status] ?? 'unknown') : 'Off')
        this.publishProperty('course', COURSES_VB[course] ?? 'unknown')
        // Spin and temperature are selections, not live readings, and the appliance stops
        // reporting them part-way through: temperature drops to 0 when Rinsing starts and spin
        // drops to 0 at End. Holding the last reported value keeps the sensors showing what was
        // actually selected instead of blanking out mid-cycle; a powered-off machine clears them.
        if (!powered) {
            this.publishProperty('spin', 'unknown')
            this.publishProperty('temp', 'unknown')
        } else {
            if (spin !== 0) this.publishProperty('spin', SPINS[spin] ?? 'unknown')
            if (temp !== 0) this.publishProperty('temp', TEMPERATURES[temp] ?? 'unknown')
        }
        this.publishProperty('cycles', cycles)
        this.publishProperty('remote_start', lock_status & 2 ? 'ON' : 'OFF')
        this.publishProperty('door_lock', !(lock_status & 0x40) ? 'ON' : 'OFF') // inverted logic, off=locked
        this.publishProperty('child_lock', lock_status & 0x80 ? 'ON' : 'OFF')
        this.publishProperty('initial_time', time_initial)
        this.publishProperty('remaining_time', time_remain)
        this.publishProperty('energy', energy)
        this.publishProperty('detergent', DOSES[detergent] ?? 'unknown')
        this.publishProperty('softener', DOSES[softener] ?? 'unknown')
        this.publishProperty('turbowash', options & 0x01 ? 'ON' : 'OFF')
        this.publishProperty('prewash', options & 0x40 ? 'ON' : 'OFF')
        this.publishProperty('steam', options & 0x80 ? 'ON' : 'OFF')
        this.publishProperty('delay_end', delay_end)
    }

    setProperty(prop: string, mqttValue: string) {
        if (prop === 'power') {
            if (mqttValue === 'ON') {
                this.send(Buffer.from('F02A0100', 'hex'))
            } else if (mqttValue === 'OFF') {
                this.send(Buffer.from('F024010100', 'hex'))
            }
        }

        if (prop === 'pause') this.send(Buffer.from('F024040100', 'hex'))
        if (prop === 'start') this.send(Buffer.from(mqttValue || 'F024050100', 'hex'))
    }
}
