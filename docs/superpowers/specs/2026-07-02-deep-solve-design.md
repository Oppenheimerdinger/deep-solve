# deep-solve — 설계 스펙

**날짜**: 2026-07-02
**상태**: 설계 승인 대기
**계보**: `delegating-hard-problems` + `review-to-convergence` 스킬을 하나의 자동화 하네스로 묶음.

## 목적

어려운 self-contained 하위문제를 만났을 때, 사람(또는 main agent)의 중간 개입 없이
**delegate → 독립 리뷰 → 재-solve → 수렴** 루프를 끝까지 돌리고, 수렴 여부와 증거 등급을
정직하게 리턴하는 플러그인.

기존 두 스킬은 각 단계의 원칙을 정의하지만, 둘을 잇는 루프는 매번 main agent가 수동으로
조립해야 했다. 이 플러그인은 그 조립을 (a) 자동 발화 스킬, (b) 수동 커맨드, (c) 결정론적
Workflow 스크립트로 고정한다.

## 패키징

플러그인 하나. 자동 발화(스킬)와 수동 발화(커맨드)가 같은 Workflow 스크립트를 공유한다.

```
deep-solve/
├── .claude-plugin/plugin.json
├── skills/deep-solve/
│   ├── SKILL.md              # 자동 발화 + Phase 1 지시 + Phase 2 킥오프 지시
│   └── solve-converge.js     # Phase 2 Workflow 스크립트 (스킬 base dir 기준 scriptPath로 호출)
└── commands/deep-solve.md    # /deep-solve [문제] — 같은 스킬 흐름을 수동 트리거
```

- Workflow는 named workflow가 아니라 **`scriptPath`** 로 호출한다 (플러그인이 스킬 base dir을
  알려주므로 경로 해석이 안정적).
- 기존 `delegating-hard-problems` / `review-to-convergence` 스킬은 **삭제하지 않는다**.
  deep-solve는 이 둘을 계승·참조하고, 범용 리뷰 루프는 독립적으로 계속 쓰인다.
- 설치: 로컬 marketplace (`claude plugin marketplace add <dev dir>`) 또는 심링크. dev 트리가
  진실이고, 배포는 별도 스냅숏 없이 로컬 설치로 충분 (개인용).

## 실행 모델 — 2 phase

핵심 분업: **brief 작성·수렴은 author-in-the-loop (main agent)**, **solve 수렴은 결정론
Workflow**. 근거: brief를 고치려면 매 라운드 main의 세션 컨텍스트(실제 file:line, 측정값,
이미 배제한 가정)가 필요하므로 자동화가 원리적으로 불가능. 반면 brief가 자기완결이 된
순간 solving은 컨텍스트가 필요 없어 완전 자동화 가능.

### Phase 1 — brief 수렴 (main agent, 스킬 지시)

1. main이 self-contained brief 작성 — `delegating-hard-problems`의 체크리스트 그대로:
   모든 기호 정의, 필요한 수치·사실 인라인, 실제 시스템에 충실(file:line), 확정 제약 명시,
   유효한 답의 형태 명시, "see the session" 금지. **main의 잠정 결론은 brief에서 은닉.**
2. **brief 리뷰 루프** (`review-to-convergence`, main-loop에서 실행):
   fresh independent reviewer (Agent tool, 기본 `model: opus`)가 self-contained / faithful /
   solvable 3축으로 검증 → main이 수정 → 재리뷰 → **zero-finding까지**.
3. 수렴한 brief를 `args`로 Phase 2 Workflow에 전달.

### Phase 2 — solve 수렴 (Workflow, 완전 자동)

#### args

```js
{
  brief: string,        // Phase 1에서 수렴한 brief (필수)
  maxRounds: 4,         // solve 호출 총예산. 확증 solve 포함. 사용자 지시/인자로 오버라이드
  confirm: true,        // false면 확증 solve 생략 (증거 등급 영구 reviewer-silence 캡)
  reviewers: 1,         // 라운드당 리뷰어 수. >1이면 N-vote 패널 (load-bearing 문제용)
  model: "opus"         // solver/reviewer/확증 모델. "fable"은 사용자가 명시 요청 시에만
}
```

#### 라운드 스케줄 (결정론 — LLM 라우팅 없음)

라운드 번호로 하드코딩. **분류 대신 스케줄링**: structural 오류의 신호는 리뷰어의 라벨이
아니라 "REPAIR를 거쳤는데도 리뷰어가 침묵하지 않음"이라는 결정론적 이벤트다. 오판 비용은
비대칭적으로 싸다 (local이었으면 COLD 1회 낭비, structural이었으면 앵커 탈출).

| 라운드 | 모드 | solver가 받는 컨텍스트 |
|---|---|---|
| 1 | COLD | brief만 |
| 2 | REPAIR | brief + 답안₁ + findings₁ + frame-first 지시("이전 답을 읽기 전에 brief만으로 올바른 접근을 재유도하라. 이전 답은 salvage 재료다: 프레임 keep-or-replace를 명시적으로 판단·정당화하라. 나열된 findings에 국한하지 말라") |
| 3 | COLD | brief + 누적 findings (라운드 태그, pitfall list로 프레이밍; **이전 답안 은닉**) |
| 마지막 | SYNTH | brief + 양쪽 계보의 최선 답안 + 전체 findings → 프레임 판정 먼저, 그 후 승자 수리 |

`maxRounds > 4` 일반화: **마지막 라운드 = SYNTH, 그 외 홀수 = COLD, 짝수 = REPAIR.**

- **solver**: 매 라운드 fresh, `model: args.model` (기본 **opus**), `effort: max`.
  **fable은 사용자가 명시적으로 요청한 경우에만** (`"fable로"`, `--model fable` 등) 사용.
- **reviewer**: 매 라운드 fresh + **brief와 제출 답안만** 받음. 이전 findings를 주지 않는다
  (체크리스트 편향 + 제2의 앵커링 채널 차단). REPAIR가 유발한 회귀를 잡는 것은 이
  전체-재검이다. `reviewers > 1`이면 독립 패널: findings는 **union**(한 명이라도 지적하면
  finding), zero-finding 판정은 **전원 침묵**일 때만. (패널을 요청했다 = 수렴 기준을
  엄격화했다.)

#### 조기 종료 + 확증 solve

어느 라운드든 zero-finding이면 즉시 종료 후보. "리뷰어 침묵"은 위조 가능한 증거이므로
(patch-until-silent = 프레임 검증이 아닌 프레임 순응) `converged: true`의 증거 등급을
나눈다:

- zero-finding **and** 예산 잔여 **and** `confirm`: **cold 확증 solve** 1회 (brief만,
  답 중심 출력) → 결론 동치성 비교 → 일치 시 `evidence: "independent-agreement"`.
  불일치 시 불일치 자체가 findings가 되고, **다음 라운드는 스케줄과 무관하게 SYNTH 강제**
  (양쪽 답안이 이미 존재하므로 판정·병합이 옳음; 홀수=COLD 일반화 규칙보다 우선).
- zero-finding인데 예산 소진: `evidence: "reviewer-silence"` — 추가 지출 대신 정직한 강등.
- 동치성 비교: 구조화된 출력(알고리즘명·수식·수치)이면 결정론 비교, 아니면 좁은 단답형
  equivalence agent 1회 (좁은 질문이므로 mode-5 누출이 제한적: false-disagree는 1라운드
  추가 비용, false-agree는 독립 유도 2개가 우연히 같은 오답 — 복합 저확률).

#### 미수렴 종료

- **best-of 반환**: 매 라운드 (답안, findings) 보존; 소진 시 `argmin(findings 수)`,
  동률이면 최신. 스래싱이 결과물을 퇴화시킬 수 없게 구조적으로 봉쇄.
- 리턴: `{ answer, converged: false, findings: [...], evidence: null, roundsUsed, log }`.
  **조용히 성공인 척하지 않는다** (silent truncation 금지).

#### 리턴 계약

```js
{
  answer,               // 최종 or best-of 답안
  converged: bool,
  evidence: "independent-agreement" | "reviewer-silence" | null,
  findings: [],         // 미수렴 시 잔여 findings
  roundsUsed, log       // 라운드별 (모드, findings 수) 이력
}
```

main agent의 후처리 (스킬이 지시):
- `converged: true` + `independent-agreement` → 채택.
- `reviewer-silence` → 채택하되 증거 등급을 사용자에게 명시.
- `converged: false` → Phase 1 회귀(brief 결함 의심) 또는 사용자 에스컬레이트. 자동 재실행 금지.

#### 경로별 예산 (default N=4의 근거)

| 경로 | solve 소모 | 결말 |
|---|---|---|
| happy (brief가 좋음) | 2 | independent-agreement |
| 국소 실수 | 3 | independent-agreement |
| structural, COLD(3) 해결 | 4 | independent-agreement |
| structural, SYNTH까지 | 4 | reviewer-silence (정직 강등) |

Phase 1이 brief를 이미 수렴시키므로 SYNTH 경로는 드묾. N=5 상시 예약은 드문 경로에
max-effort solve +1회를 항상 지불하는 셈이라 과함 → **default 4**, 강등을 본 main/사용자가
예산 증액 재실행을 판단.

## 킥오프 배너 (사용자 가시성)

Phase 2 Workflow 실행 **직전에** main agent가 실행 조건을 배너로 출력한다 (스킬이 지시).
정보 표시이지 승인 게이트가 아님 — 외부 개입 제거가 목적이므로 출력 후 바로 진행.

```
▶ deep-solve 시작
  모델   : opus (max effort)        ← fable 원하면 "fable로" 지시
  예산   : solve 최대 4회 (확증 포함)
  스케줄 : COLD → REPAIR → COLD → SYNTH  (조기종료 가능; 잘 된 brief는 2회로 끝남)
  리뷰어 : 1명 / 확증 solve: on
```

- 스케줄은 **펼친 시퀀스로 표기** — "홀수=COLD, 짝수=REPAIR" 같은 홀짝 규칙은 내부 구현
  일반화로만 쓰고 사용자에게 노출하지 않는다 (N=6이면
  `COLD → REPAIR → COLD → REPAIR → COLD → SYNTH`로 펼쳐서 출력).
- 종료 시에도 요약 리포트 출력: `converged / evidence / roundsUsed / (미수렴 시) 잔여 findings`.

## 발화 (트리거)

- **자동 (스킬)**: `delegating-hard-problems`의 트리거 조건 계승 — 막힘/저신뢰 + definite
  right answer + separable. 스킬 description에서 deep-solve가 hard-problem 케이스를
  포섭함을 명시해 기존 스킬과의 이중 발화를 줄임.
- **수동 (커맨드)**: `/deep-solve <문제 서술>`. 인자·자연어 지시("10라운드까지", "패널로
  검증", "확증 생략", "fable로")를 스킬이 읽어 args (`maxRounds`, `reviewers`, `confirm`,
  `model`)로 반영.

## 에러 처리

- Workflow 내 agent 사망/skip → `agent()`가 null 리턴 → 해당 라운드 스킵으로 취급하되
  라운드 카운트는 소모 (예산은 하드캡), log에 기록.
- 읽기 전용 분석 agent가 보고 없이 idle → transcript JSONL grep으로 회수 (기존 스킬 규칙
  계승; Phase 1 리뷰어에 해당).
- Phase 2가 어떤 경로로도 답 없이 끝남 (전 라운드 null) → `answer: null, converged: false`
  + log. main이 사용자 에스컬레이트.

## 테스트 계획

1. **happy path**: 답이 알려진 수학/알고리즘 문제 brief → 2 solve로 independent-agreement
   종료 확인.
2. **강제 findings**: brief에 의도적 함정(틀린 수치 1개) → REPAIR 경로 진입, findings
   전파 형식 확인.
3. **미수렴**: `maxRounds: 2` + 어려운 문제 → best-of + `converged: false` + findings
   리턴 형식 확인.
4. **오버라이드**: `/deep-solve ... 6라운드, 리뷰어 3` → args 반영 확인.
5. **회수 규칙**: 리뷰어 idle 시 JSONL grep 경로 동작 확인 (Phase 1).

## 결정 이력 (요약)

- **2-phase 분업**: brief는 author-in-the-loop라 자동화 불가 — 사용자 지적으로 확정.
- **재-solve 컨텍스트**: ①(findings만) vs ②(답안 통째) vs typed-routing(리뷰어 분류 기반)
  모두 기각 → **스케줄드 교대 + best-of + cold 확증** 채택. 근거: 앵커링(②)과
  스래싱(①)은 상보적 실패이며, LLM 분류(typed-routing)는 루프 내 노이지 판단(mode 5).
  fresh Fable cold 유도와 main의 독립 분석이 "하이브리드 + 최종 cold 확증"에서 수렴한
  것이 채택 증거. (이 결정 과정 자체가 본 플러그인의 실전 드라이런이었음.)
- **default maxRounds=4**: 위 경로별 예산 표. 사용자 오버라이드 허용.
- **default model=opus**: fable/max는 명시 요청 시에만 (2026-07-02 사용자 지시). 킥오프
  배너로 모델·예산·스케줄을 실행 전에 가시화; 스케줄은 홀짝 규칙이 아닌 펼친 시퀀스로 표기.
