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
