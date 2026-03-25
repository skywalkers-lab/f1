export type SessionMode = {
  mode: 'practice' | 'qualifying' | 'race' | 'unknown'
  label: string
  focus: string
}

const MAP: Record<number, SessionMode> = {
  0: { mode: 'unknown', label: 'UNKNOWN', focus: '세션 메타데이터 대기 중' },
  1: { mode: 'practice', label: 'P1', focus: '기본 페이스와 타이어 학습' },
  2: { mode: 'practice', label: 'P2', focus: '롱런 연료/디그라데이션 확인' },
  3: { mode: 'practice', label: 'P3', focus: '퀄리파잉 준비와 최종 셋업' },
  5: { mode: 'qualifying', label: 'Q1', focus: '트래픽 윈도우와 뱅커랩 운영' },
  6: { mode: 'qualifying', label: 'Q2', focus: '타이어 커밋과 컷라인 대응' },
  7: { mode: 'qualifying', label: 'Q3', focus: '최종 어택랩 실행' },
  8: { mode: 'qualifying', label: 'SHORT Q', focus: '짧은 세션에서 즉시 어택랩' },
  9: { mode: 'qualifying', label: 'ONE-SHOT Q', focus: '단발 랩 최적화' },
  10: { mode: 'race', label: 'RACE', focus: '스틴트 전략과 언더컷/오버컷' },
}

export function deriveSessionMode(sessionType?: string): SessionMode {
  const id = Number((sessionType ?? '').replace(/\D/g, ''))
  return MAP[id] ?? MAP[0]
}
