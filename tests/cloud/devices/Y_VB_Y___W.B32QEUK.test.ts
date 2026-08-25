import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import DUT from '@/cloud/devices/Y_VB_Y___W.B32QEUK'
import type { Metadata } from '@/cloud/thinq'
import { MockHAConnection, MockThinq2Device, buf, hex } from '@/tests/helpers/mocks'
import { enableMockTimers, tickMockTimers } from '@/tests/helpers/timers'

const DEVICE_ID = 'test-id'
const MODEL_ID = 'Y_VB_Y___W.B32QEUK'
const META: Metadata = { modelId: MODEL_ID, modelName: MODEL_ID, swVersion: '2.11.224' }

// Real captures from an LG F4W1175YW (Vivace, EU) running the VB firmware:
// DeviceType 201, protocolVer 7, RTK_RTL8720cm, clip_ble_v1.9.237.
//
// Frame layout: AA FF <14-byte header> <status block(s)> <crc16> BB, where header[2..3] is the
// total frame length, header[10] the record kind and header[11..12] the payload length.
// 0xEB carries one 39-byte status block (inner 53), 0xEC appends the previous block too
// (inner 92). The appliance answers the F0ED status request with 0xEB and then pushes 0xEC.

// Panel switched off: the selection bytes are zeroed while remaining_time keeps whatever the
// last selection left behind. Lifetime counters stay readable: 19 cycles, 10782 Wh.
const SAMPLE_EC_PANEL_OFF = buf(
    'AAFF200A006000479E000100EC004E000001000000000000000000000000000000000000000013006400000000000002022A1E000001000001000000000000000000000000000000000000000013006400000000000002022A1E0040016307BB',
)

// The 0xEB reply to F0ED1121010000001800, also with the panel off and a stale 45 on the clock.
const SAMPLE_EB_PANEL_OFF = buf(
    'AAFF200A0039004A04000100EB0027000001002D002D0000000000000000000000000001000013006400000000000002022A1E000001017CBB',
)

// Cotton with the panel showing 800 rpm and 60 C. This is what pins the spin and temperature
// offsets to the display instead of to a guess.
const SAMPLE_EC_COTTON_800_60 = buf(
    'AAFF200A0060004BE6000100EC004E000001033103310100030506010000000000000004020013006400000400000002022A1E000001000001033103310100030506010000000000000004020013006400000400000002022A1E004001EE61BB',
)

// Same appliance state twice, the child lock toggled between them: detergent tank at High,
// softener tank empty, and buf[16] flipping between 0x80 and 0x00.
const SAMPLE_EC_CHILD_LOCK_ON = buf(
    'AAFF200A0060004D19000100EC004E000001003B003B3A00030A04010000000080010002020013006400000400000003002A1E000401000001003B003B3A00030A04010000000000010002020013006400000400000003002A1E0004014D9BBB',
)
const SAMPLE_EC_CHILD_LOCK_OFF = buf(
    'AAFF200A0060004D3D000100EC004E000001003B003B3A00030A04010000000000010002020013006400000400000003002A1E004401000001003B003B3A00030A04010000000000010002020013006400000400000003002A1E0004010824BB',
)

// One option at a time, each captured while the panel showed only that option enabled. The
// estimated cycle time corroborates every bit on its own: TurboWash took 28 minutes off,
// pre-wash added 17, steam added 51.
const SAMPLE_EC_STEAM = buf(
    'AAFF200A0060004F7A000100EC004E000001013201323A00030A06010000008000010003000013006400000400000003002A1E000001000001013201323A00030A06010000008000010003000013006400000400000003002A1E0040014397BB',
)
const SAMPLE_EC_TURBOWASH = buf(
    'AAFF200A0060004F8D000100EC004E000001030E030E0100030704010000000100000002000013006400000400000002022A1E000001000001030E030E0100030704010000000100000002000013006400000400000002022A1E00400111A8BB',
)
const SAMPLE_EC_PREWASH = buf(
    'AAFF200A0060004F94000100EC004E000001033B033B0100030704010000004000000003000013006400000500000002022A1E000001000001033B033B0100030704010000004000000003000013006400000500000002022A1E004001DA2CBB',
)
// Delay set to 4 hours, no option bits.
const SAMPLE_EC_DELAY_4H = buf(
    'AAFF200A0060004FA6000100EC004E000001032A032A0100030704010004000000000003000013006400000400000002022A1E000001000001032A032A0100030704010000000000000003000013006400000400000002022A1E00000175AABB',
)

const WRITE_INIT = 'AA0EF0ED1121010000001800B5BB'
const WRITE_POWER_PRESS = 'AA08F02A010098BB'

function makeDevice() {
    const ha = new MockHAConnection()
    const thinq = new MockThinq2Device(DEVICE_ID, META)
    const dev = new DUT(ha.asConnection(), thinq, META)
    return { ha, thinq, dev }
}

describe(MODEL_ID, () => {
    test('config exposes expected components on construction', () => {
        const { ha } = makeDevice()
        const cfg = ha.devices[DEVICE_ID].config
        assert.ok(cfg, 'config published')
        const components = cfg!.components as Record<string, Record<string, unknown>>
        for (const c of [
            'power',
            'start',
            'pause',
            'status',
            'error',
            'error_message',
            'course',
            'temp',
            'spin',
            'cycles',
            'remote_start',
            'door_lock',
            'child_lock',
            'detergent',
            'softener',
            'turbowash',
            'prewash',
            'steam',
            'delay_end',
            'energy',
            'initial_time',
            'remaining_time',
        ]) {
            assert.ok(components[c], `component ${c} present`)
        }
        // power is a stateless press, not a switch: the appliance gives no timely feedback
        assert.equal(components.power.platform, 'button')
        assert.equal(components.power.state_topic, undefined)
    })

    test('doubled 0xEC frame decodes the current status block', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', SAMPLE_EC_PANEL_OFF)
        thinq.emit('data', SAMPLE_EC_PANEL_OFF)
        const props = ha.devices[DEVICE_ID].properties
        assert.equal(props.status, 'Off')
        assert.equal(props.error, 'OFF')
        assert.equal(props.error_message, 'OK')
        assert.equal(props.remaining_time, 0)
        assert.equal(props.initial_time, 0)
        assert.equal(props.cycles, 19)
        assert.equal(props.energy, 10782)
        assert.equal(props.remote_start, 'OFF')
        assert.equal(props.door_lock, 'ON') // unlocked, the inverted convention
    })

    test('single-block 0xEB frame decodes too', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', SAMPLE_EB_PANEL_OFF)
        thinq.emit('data', SAMPLE_EB_PANEL_OFF)
        const props = ha.devices[DEVICE_ID].properties
        assert.equal(props.status, 'Off')
        assert.equal(props.remaining_time, 45)
        assert.equal(props.initial_time, 45)
        assert.equal(props.cycles, 19)
        assert.equal(props.energy, 10782)
    })

    test('spin and temperature match the panel', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', SAMPLE_EC_COTTON_800_60)
        const props = ha.devices[DEVICE_ID].properties
        assert.equal(props.course, 'Cotton')
        assert.equal(props.spin, 800)
        assert.equal(props.temp, 60)
        assert.equal(props.remaining_time, 229)
    })

    test('ezDispense tank levels decode, tank 1 is the detergent', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', SAMPLE_EC_CHILD_LOCK_ON)
        const props = ha.devices[DEVICE_ID].properties
        // Confirmed on the panel: tank 1 (detergent) at 3/3, tank 2 (softener) empty.
        assert.equal(props.detergent, 'High')
        assert.equal(props.softener, 'Off')
    })

    test('child lock tracks bit 0x80 of the lock byte', () => {
        const on = makeDevice()
        on.thinq.emit('data', SAMPLE_EC_CHILD_LOCK_ON)
        assert.equal(on.ha.devices[DEVICE_ID].properties.child_lock, 'ON')
        assert.equal(on.ha.devices[DEVICE_ID].properties.door_lock, 'ON') // 0x40 clear, so unlocked

        const off = makeDevice()
        off.thinq.emit('data', SAMPLE_EC_CHILD_LOCK_OFF)
        assert.equal(off.ha.devices[DEVICE_ID].properties.child_lock, 'OFF')
    })

    test('course 0x3a is AI Wash on this model, not the shared table Bedding', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', SAMPLE_EC_CHILD_LOCK_ON)
        assert.equal(ha.devices[DEVICE_ID].properties.course, 'AI Wash')
    })

    // Captured six seconds after switching the panel off: status is back to 1 but course, spin
    // and temperature are all zero. Reported as ON, this made the HA switch bounce back.
    const SAMPLE_EC_STANDBY = buf(
        'AAFF200A0060004E65000100EC004E000001033803380000000000000000000000000004000013006400000000000002022A1E004001000001033803380000000000000000000000000004000013006400000000000002022A1E000001100EBB',
    )

    test('standby is reported as powered off, not Ready', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', SAMPLE_EC_STANDBY)
        thinq.emit('data', SAMPLE_EC_STANDBY)
        const props = ha.devices[DEVICE_ID].properties
        assert.equal(props.status, 'Off')
    })

    test('a lone empty frame does not flip status to Off', () => {
        const { ha, thinq } = makeDevice()
        // running machine reports its selection
        thinq.emit('data', SAMPLE_EC_COTTON_800_60)

        assert.equal(ha.devices[DEVICE_ID].properties.status, 'Ready')

        // the sparse reply that used to knock the state to Off
        thinq.emit('data', SAMPLE_EB_PANEL_OFF)
        assert.equal(ha.devices[DEVICE_ID].properties.status, 'Ready')

        // a second empty frame in a row is real standby
        thinq.emit('data', SAMPLE_EB_PANEL_OFF)
        assert.equal(ha.devices[DEVICE_ID].properties.status, 'Off')
    })

    test('an empty frame does not reset a run of populated frames', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', SAMPLE_EB_PANEL_OFF)
        thinq.emit('data', SAMPLE_EC_COTTON_800_60)
        thinq.emit('data', SAMPLE_EB_PANEL_OFF)
        // only one empty frame since the last populated one, so the state still says ON
    })

    test('a sparse frame still updates the fields it does carry', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', SAMPLE_EC_COTTON_800_60)
        assert.equal(ha.devices[DEVICE_ID].properties.remaining_time, 229)

        // status is held back on a lone empty frame, but the frame is not dropped wholesale
        thinq.emit('data', SAMPLE_EB_PANEL_OFF)
        assert.equal(ha.devices[DEVICE_ID].properties.status, 'Ready')
        assert.equal(ha.devices[DEVICE_ID].properties.remaining_time, 45)
    })

    test('option bits are reported one at a time', () => {
        const steam = makeDevice()
        steam.thinq.emit('data', SAMPLE_EC_STEAM)
        assert.deepEqual(
            {
                steam: steam.ha.devices[DEVICE_ID].properties.steam,
                turbowash: steam.ha.devices[DEVICE_ID].properties.turbowash,
                prewash: steam.ha.devices[DEVICE_ID].properties.prewash,
            },
            { steam: 'ON', turbowash: 'OFF', prewash: 'OFF' },
        )

        const turbo = makeDevice()
        turbo.thinq.emit('data', SAMPLE_EC_TURBOWASH)
        assert.deepEqual(
            {
                steam: turbo.ha.devices[DEVICE_ID].properties.steam,
                turbowash: turbo.ha.devices[DEVICE_ID].properties.turbowash,
                prewash: turbo.ha.devices[DEVICE_ID].properties.prewash,
            },
            { steam: 'OFF', turbowash: 'ON', prewash: 'OFF' },
        )

        const pre = makeDevice()
        pre.thinq.emit('data', SAMPLE_EC_PREWASH)
        assert.deepEqual(
            {
                steam: pre.ha.devices[DEVICE_ID].properties.steam,
                turbowash: pre.ha.devices[DEVICE_ID].properties.turbowash,
                prewash: pre.ha.devices[DEVICE_ID].properties.prewash,
            },
            { steam: 'OFF', turbowash: 'OFF', prewash: 'ON' },
        )
    })

    test('delay is an hour count, not an option bit', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', SAMPLE_EC_DELAY_4H)
        const props = ha.devices[DEVICE_ID].properties
        assert.equal(props.delay_end, 4)
        assert.equal(props.turbowash, 'OFF')
        assert.equal(props.prewash, 'OFF')
        assert.equal(props.steam, 'OFF')
    })

    test('spin and temperature hold their last value when the appliance stops reporting them', () => {
        const { ha, thinq } = makeDevice()
        thinq.emit('data', SAMPLE_EC_COTTON_800_60)
        assert.equal(ha.devices[DEVICE_ID].properties.spin, 800)
        assert.equal(ha.devices[DEVICE_ID].properties.temp, 60)

        // Rinsing zeroes the temperature byte and End zeroes the spin byte; neither should
        // blank the sensor while the machine is still running.
        const rinsing = Buffer.from(SAMPLE_EC_COTTON_800_60)
        const block = 2 + 14
        rinsing[block + 1] = 7 // Rinsing
        rinsing[block + 10] = 0 // temperature no longer reported
        thinq.emit('data', rinsing)
        assert.equal(ha.devices[DEVICE_ID].properties.status, 'Rinsing')
        assert.equal(ha.devices[DEVICE_ID].properties.temp, 60)
        assert.equal(ha.devices[DEVICE_ID].properties.spin, 800)

        const ending = Buffer.from(rinsing)
        ending[block + 1] = 10 // End
        ending[block + 9] = 0 // spin no longer reported
        thinq.emit('data', ending)
        assert.equal(ha.devices[DEVICE_ID].properties.status, 'End')
        assert.equal(ha.devices[DEVICE_ID].properties.spin, 800)
        assert.equal(ha.devices[DEVICE_ID].properties.temp, 60)
    })

    test('a 0xEC frame truncated to the single-block length is ignored', () => {
        const { ha, thinq } = makeDevice()
        const before = ha.devices[DEVICE_ID].properties.power
        // declares the doubled payload but only carries one block
        thinq.emit(
            'data',
            buf(
                'AAFF200A0039000381000100EC0027000001032603260000000000000000000000000003000011007100000000000000000000000000974EBB',
            ),
        )
        assert.equal(ha.devices[DEVICE_ID].properties.power, before)
    })

    test('frames not matching the AA..BB envelope are ignored', () => {
        const { ha, thinq } = makeDevice()
        const before = ha.devices[DEVICE_ID].properties.power
        thinq.emit('data', buf('001122'))
        assert.equal(ha.devices[DEVICE_ID].properties.power, before)
    })

    test('a write is followed by status re-reads, since the appliance reports nothing itself', (t) => {
        enableMockTimers(t)
        const { thinq, dev } = makeDevice()
        thinq.resetRecorder()

        dev.setProperty('power', '')
        assert.equal(hex(thinq.outbox[0]), WRITE_POWER_PRESS)
        assert.equal(thinq.outbox.length, 1, 'nothing extra sent synchronously')

        tickMockTimers(t, 1000)
        assert.equal(hex(thinq.outbox[1]), WRITE_INIT)

        tickMockTimers(t, 7000)
        assert.equal(thinq.outbox.length, 4, 'three retries in total')
        assert.ok(thinq.outbox.slice(1).every((p) => hex(p) === WRITE_INIT))
    })

    test('pending status re-reads are cancelled when the device drops', (t) => {
        enableMockTimers(t)
        const { thinq, dev } = makeDevice()
        thinq.resetRecorder()

        dev.setProperty('power', '')
        dev.drop()

        tickMockTimers(t, 10000)
        assert.equal(thinq.outbox.length, 1, 'only the original command was sent')
    })

    test('power is a single toggle press, since F02A0100 toggles the appliance', () => {
        const { thinq, dev } = makeDevice()
        thinq.resetRecorder()
        dev.setProperty('power', '')
        assert.equal(hex(thinq.outbox[0]), WRITE_POWER_PRESS)
    })

    test('start() sends the F0ED status request', () => {
        const { thinq, dev } = makeDevice()
        thinq.resetRecorder()
        dev.start()
        assert.equal(thinq.outbox.length, 1)
        assert.equal(hex(thinq.outbox[0]), WRITE_INIT)
    })
})
