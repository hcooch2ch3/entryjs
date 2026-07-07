'use strict';

const MODULE_PATH = '../../src/playground/blocks/hardwareLite/block_hamster_lite';

// 실측 캡처 라인 (2026-06-30, 신형 Robomation 동글)
const LINE_OLD = 'FF01,Hamster,04,05,BA4A0461D9DA';
const LINE_S = 'FF01,Hamster-S,0E,00,FDA3ECEC3AC4';
const LINE_RENAMED = 'FF01,철수의 햄스터,04,05,BA4A0461D9DA';
const LINE_COMMA_NAME = 'FF01,Ham,ster,04,05,BA4A0461D9DA';
const LINE_TURTLE = 'FF01,Turtle,09,02,4ED7EEBFD8F4';
const LINE_SENSORY = `1${'0'.repeat(52)}`; // 53자 센서 프레임 모사

function loadModule() {
    jest.resetModules();
    global.Entry = {};
    // eslint-disable-next-line global-require
    return require(MODULE_PATH);
}

describe('parseIdentityData (이름-독립 뒤-인덱스 파싱)', () => {
    let hamster;
    beforeEach(() => {
        hamster = loadModule();
    });

    test('구형 햄스터 정체 라인 파싱', () => {
        expect(hamster.parseIdentityData(LINE_OLD)).toEqual({
            isHamsterS: false,
            address: 'BA4A0461D9DA',
        });
    });

    test('햄스터S 정체 라인 파싱', () => {
        expect(hamster.parseIdentityData(LINE_S)).toEqual({
            isHamsterS: true,
            address: 'FDA3ECEC3AC4',
        });
    });

    test('리네임된 로봇(이름 불일치)도 파싱된다', () => {
        expect(hamster.parseIdentityData(LINE_RENAMED)).toEqual({
            isHamsterS: false,
            address: 'BA4A0461D9DA',
        });
    });

    test('이름에 콤마가 있어도 뒤-인덱스라 안전', () => {
        expect(hamster.parseIdentityData(LINE_COMMA_NAME)).toEqual({
            isHamsterS: false,
            address: 'BA4A0461D9DA',
        });
    });

    test('종단 CR/LF가 붙어도 주소 hex 검증을 통과한다', () => {
        expect(hamster.parseIdentityData(`${LINE_OLD}\r\n`)).toEqual({
            isHamsterS: false,
            address: 'BA4A0461D9DA',
        });
    });

    test('다른 패밀리 기종(터틀 09)은 undefined', () => {
        expect(hamster.parseIdentityData(LINE_TURTLE)).toBeUndefined();
    });


    test('주소가 12hex 초과면 거부한다 (레거시 truncate 관용의 의도적 강화)', () => {
        expect(hamster.parseIdentityData('FF01,Hamster,04,05,BA4A0461D9DAFFFF')).toBeUndefined();
    });

    test('센서 프레임/짧은 FF 라인/비문자열은 undefined', () => {
        expect(hamster.parseIdentityData(LINE_SENSORY)).toBeUndefined();
        expect(hamster.parseIdentityData('FF01,x')).toBeUndefined();
        expect(hamster.parseIdentityData('FF01,Hamster,04,05,BA4A04')).toBeUndefined(); // 주소 12hex 미달
        expect(hamster.parseIdentityData(undefined)).toBeUndefined();
    });
});

function createMockSerial(lines) {
    const queue = [...lines];
    const pendingReads = [];
    return {
        reader: {
            read: jest.fn(() => {
                if (queue.length) {
                    return Promise.resolve({ value: queue.shift(), done: false });
                }
                // 데이터 없음 = pending (미페어링 동글).
                // 실제 Web Streams 계약: reader.cancel()이 pending read를 {done:true}로 settle한다.
                // removeSerialPort()가 내부에서 cancel하므로 mock도 동일하게 모델링한다.
                return new Promise((resolve) => pendingReads.push(resolve));
            }),
        },
        sendAsciiAsBuffer: jest.fn(),
        removeSerialPort: jest.fn(() => {
            pendingReads.splice(0).forEach((resolve) => resolve({ value: undefined, done: true }));
            return Promise.resolve();
        }),
        update: jest.fn(),
    };
}

describe('initialHandshake', () => {
    let hamster;
    beforeEach(() => {
        hamster = loadModule();
        hamster.handshakeTimeoutMs = 30; // 테스트용 단축 (제품 기본값 5000ms)
    });

    test('센서 프레임 뒤 구형 정체 라인 → 성공, isHamsterS=false, 포트 정리 안 함', async () => {
        const serial = createMockSerial([LINE_SENSORY, LINE_OLD]);
        global.Entry.hwLite = { serial };
        await expect(hamster.initialHandshake()).resolves.toBe(true);
        expect(hamster.isHamsterS).toBe(false);
        expect(hamster.address).toBe('BA4A0461D9DA');
        expect(serial.removeSerialPort).not.toHaveBeenCalled();
        // 선제 요청 + 비-FF(센서) 라인 후 재요청
        expect(serial.sendAsciiAsBuffer).toHaveBeenCalledWith('FF\r');
    });

    test('햄스터S 정체 라인 → isHamsterS=true', async () => {
        const serial = createMockSerial([LINE_S]);
        global.Entry.hwLite = { serial };
        await expect(hamster.initialHandshake()).resolves.toBe(true);
        expect(hamster.isHamsterS).toBe(true);
        expect(hamster.address).toBe('FDA3ECEC3AC4');
    });

    test('성공해도 this.id는 변이되지 않는다 (재선택 후 저장 시 오염 방지)', async () => {
        const serial = createMockSerial([LINE_OLD]);
        global.Entry.hwLite = { serial };
        await hamster.initialHandshake();
        expect(hamster.id).toBe('020401');
    });

    test('정체 라인이 안 오면 타임아웃 → 포트 정리 후 false', async () => {
        const serial = createMockSerial([]); // read 무한 pending
        global.Entry.hwLite = { serial };
        await expect(hamster.initialHandshake()).resolves.toBe(false);
        expect(serial.removeSerialPort).toHaveBeenCalledTimes(1);
    });

    test('타임아웃 패자로 남은 pending read는 removeSerialPort(cancel)가 {done:true}로 정리한다', async () => {
        const serial = createMockSerial([]);
        global.Entry.hwLite = { serial };
        await expect(hamster.initialHandshake()).resolves.toBe(false);
        // pending read가 settle되어 unhandled rejection 없이 종료되는 것 자체가 계약
        expect(serial.reader.read).toHaveBeenCalled();
        expect(serial.removeSerialPort).toHaveBeenCalledTimes(1);
    });

    test('reader done(스트림 종료) → 포트 정리 후 false', async () => {
        const serial = createMockSerial([]);
        serial.reader.read = jest.fn(() => Promise.resolve({ value: undefined, done: true }));
        global.Entry.hwLite = { serial };
        await expect(hamster.initialHandshake()).resolves.toBe(false);
        expect(serial.removeSerialPort).toHaveBeenCalled();
    });

    test('read가 reject(스트림 에러: 연결 중 동글 제거)해도 throw 없이 포트 정리 후 false', async () => {
        const serial = createMockSerial([]);
        serial.reader.read = jest.fn(() => Promise.reject(new Error('device yanked')));
        global.Entry.hwLite = { serial };
        await expect(hamster.initialHandshake()).resolves.toBe(false);
        expect(serial.removeSerialPort).toHaveBeenCalledTimes(1);
    });

    test('프로브 write가 동기 throw해도 포트 정리 후 false', async () => {
        const serial = createMockSerial([]);
        serial.sendAsciiAsBuffer = jest.fn(() => {
            throw new Error('writer is null');
        });
        global.Entry.hwLite = { serial };
        await expect(hamster.initialHandshake()).resolves.toBe(false);
        expect(serial.removeSerialPort).toHaveBeenCalledTimes(1);
    });

    test('다른 기종(터틀)만 응답하면 FF 라인엔 재프로브 없이 타임아웃 후 정리', async () => {
        const serial = createMockSerial([LINE_TURTLE]);
        global.Entry.hwLite = { serial };
        await expect(hamster.initialHandshake()).resolves.toBe(false);
        expect(serial.removeSerialPort).toHaveBeenCalled();
        // 선제 1회만 — FF-프리픽스 라인에는 재요청하지 않는다(원본 동작 유지)
        expect(serial.sendAsciiAsBuffer).toHaveBeenCalledTimes(1);
    });
});

describe('handleLocalData 런타임 재식별 (연결 유지 중 로봇 교체)', () => {
    let hamster;
    let serial;
    beforeEach(() => {
        hamster = loadModule();
        serial = createMockSerial([]);
        global.Entry.hwLite = { serial };
    });

    test('동일 정체 라인 2회 확인 시 isHamsterS/address 갱신 + setZero', () => {
        hamster.isHamsterS = false;
        hamster.address = 'BA4A0461D9DA';
        hamster.motoring.leftWheel = 50; // 이전 로봇에게 주행 명령 중이었다고 가정
        hamster.handleLocalData(LINE_S); // 1회차: 보류
        expect(hamster.isHamsterS).toBe(false);
        hamster.handleLocalData(LINE_S); // 2회차: 전환
        expect(hamster.isHamsterS).toBe(true);
        expect(hamster.address).toBe('FDA3ECEC3AC4');
        expect(hamster.motoring.leftWheel).toBe(0); // setZero로 구동 상태 리셋
        expect(serial.update).toHaveBeenCalled(); // 새 정체 기준 정지 패킷 write
    });

    test('낯선 정체 라인 1회(노이즈)로는 전환도 정지도 하지 않는다', () => {
        hamster.isHamsterS = false;
        hamster.address = 'BA4A0461D9DA';
        hamster.motoring.leftWheel = 50;
        hamster.handleLocalData(LINE_S); // stray 1회
        hamster.handleLocalData(`0000${'1'}${'0'.repeat(48)}`); // 구형 유효 프레임
        expect(hamster.isHamsterS).toBe(false);
        expect(hamster.motoring.leftWheel).toBe(50); // 정지 없음
    });

    test('보류된 재식별은 60프레임 내 재확인 없으면 만료된다 (무관한 2회 오전환 방지)', () => {
        hamster.isHamsterS = false;
        hamster.address = 'BA4A0461D9DA';
        hamster.motoring.leftWheel = 50;
        const goodFrame = `0000${'1'}${'0'.repeat(48)}`;
        hamster.handleLocalData(LINE_S); // 1회차: 보류
        for (let i = 0; i < 60; i++) {
            hamster.handleLocalData(goodFrame); // 60프레임 경과 → 보류 만료
        }
        hamster.handleLocalData(LINE_S); // 만료 후라 다시 1회차일 뿐
        expect(hamster.isHamsterS).toBe(false);
        expect(hamster.motoring.leftWheel).toBe(50);
    });

    test('현재와 같은 정체 재수신은 setZero를 부르지 않는다', () => {
        hamster.isHamsterS = false;
        hamster.address = 'BA4A0461D9DA';
        hamster.motoring.leftWheel = 50;
        hamster.handleLocalData(LINE_OLD);
        hamster.handleLocalData(LINE_OLD);
        expect(hamster.motoring.leftWheel).toBe(50);
    });

    test('검증 실패 프레임 30연속이면 FF 재요청 1회 (S 모드)', () => {
        hamster.isHamsterS = true;
        const badFrame = `0${'0'.repeat(52)}`; // S 검증(1번째 자리 1) 실패하는 53자
        for (let i = 0; i < 29; i++) {
            hamster.handleLocalData(badFrame);
        }
        expect(serial.sendAsciiAsBuffer).not.toHaveBeenCalled();
        hamster.handleLocalData(badFrame); // 30번째
        expect(serial.sendAsciiAsBuffer).toHaveBeenCalledTimes(1);
        expect(serial.sendAsciiAsBuffer).toHaveBeenCalledWith('FF\r');
    });

    test('검증 실패 프레임 30연속이면 FF 재요청 1회 (구형 모드)', () => {
        hamster.isHamsterS = false;
        const badFrame = `0000${'0'.repeat(49)}`; // 구형 검증(5번째 자리 1) 실패하는 53자
        for (let i = 0; i < 30; i++) {
            hamster.handleLocalData(badFrame);
        }
        expect(serial.sendAsciiAsBuffer).toHaveBeenCalledTimes(1);
    });

    test('유효 프레임이 오면 카운터가 리셋된다', () => {
        hamster.isHamsterS = true;
        const badFrame = `0${'0'.repeat(52)}`;
        const goodFrame = `1${'0'.repeat(52)}`; // S 검증 통과
        for (let i = 0; i < 29; i++) {
            hamster.handleLocalData(badFrame);
        }
        hamster.handleLocalData(goodFrame); // 카운터 리셋
        hamster.handleLocalData(badFrame); // 다시 1부터
        expect(serial.sendAsciiAsBuffer).not.toHaveBeenCalled();
    });
});
