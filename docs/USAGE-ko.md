# deep-solve 설치 및 사용 안내

어려운 문제를 "위임 → 독립 리뷰 → 재풀이" 루프로 수렴할 때까지 자동으로 푸는
Claude Code 플러그인입니다.

## 설치

Claude Code가 있는 어느 머신에서든:

```
claude plugin marketplace add Oppenheimerdinger/deep-solve
claude plugin install deep-solve@dipark
```

설치/업데이트 후 새 세션을 열거나 `/reload-plugins`를 실행해야 적용됩니다.

**업데이트**: `claude plugin update deep-solve@dipark` → `/reload-plugins`

**요구사항**: isolated 모드는 Claude Code의 Workflow 툴(멀티에이전트
오케스트레이션)을 사용합니다. 없는 환경에서는 스킬이 스스로 한계를 알리고
Agent 툴 기반 수동 루프로 대체합니다.

## 언제 쓰나

**정답이 존재하는, 자기완결 가능한 어려운 문제**에 씁니다 — 유도/증명,
알고리즘 선택, 근본원인 분석, 설계 트레이드오프 판정. 취향 문제(열린
브레인스토밍)에는 맞지 않습니다.

자동으로 발동하지 않습니다. **명시적으로 불러야만** 실행됩니다:

```
/deep-solve <문제 서술>
```

또는 대화 중 "딥솔브로 풀어줘", "deep solve로" 라고 요청.

## 실행 흐름

1. **Phase 1 — 문제 정식화(brief)**: 메인 에이전트가 자기완결 문제 문서를
   작성하고, 독립 리뷰어가 "자기완결? 시스템에 충실? 풀 수 있음? 전제
   검증됨?" 4개 축으로 zero-finding까지 검증합니다. 검증 가능한 전제는 이
   단계에서 직접 테스트됩니다.
2. **사용자 게이트**: 수렴한 brief 전문 + 실행 배너(모드/모델/예산)를
   보여주고 **당신의 승인을 기다립니다**. 여기서 brief 수정, 파라미터 조정,
   모드 변경, 취소가 가능합니다.
3. **Phase 2 — 풀이 수렴**: 승인 후 모드에 따라 실행.

## 두 가지 모드

| | **isolated** | **grounded** |
|---|---|---|
| 방식 | 결정론 Workflow, 무인 실행 | 도구 가진 solver 1 + 검증 리뷰어 1 |
| solver | brief만 보는 밀봉 상태 (closed-book) | repo/시스템을 직접 조회 (read-only) |
| 맞는 문제 | 종이 위에서 완전히 닫히는 문제 | 라이브 시스템에서 사실 확인이 필요한 문제 |
| 스케줄 | COLD → REPAIR → COLD → SYNTH + 확증 solve | solve → 리뷰(검증표) → 이어풀기 1회 |
| 최고 증거등급 | `independent-agreement` | `grounded-single-solver, reviewer-verified` |
| 자율 실행 | 가능 | 불가 (참관 필수) |

모드는 Phase 1에서 자동 추천되고 게이트에서 바꿀 수 있습니다. 애매한 경우 두
옵션을 제시하되 하나를 추천합니다.

## 옵션

```
/deep-solve <문제> [--mode isolated|grounded] [--rounds N] [--reviewers N] [--no-confirm] [--model fable]
```

자연어도 됩니다: "6라운드", "리뷰어 3", "패널로"(=리뷰어 3), "확증 생략",
"fable로", "격리로".

- 기본값: opus(max effort), solve 예산 4회(확증 포함), 리뷰어 1, 확증 on
- **fable(최상위 모델)은 명시 요청 시에만** 사용됩니다
- rounds/reviewers/confirm은 isolated 모드 전용

**자율 실행**: "자율적으로 진행해" / "승인 생략"이라고 명시하면 게이트에서
기다리지 않습니다(brief와 배너는 그래도 출력·기록됨). 단 grounded 모드는
자율 실행 불가.

## 결과 읽는 법

| 결과 | 의미 |
|---|---|
| `independent-agreement` | 독립적인 두 유도가 일치 — 가장 강한 증거 |
| `reviewer-silence` | 리뷰어 통과했으나 확증 solve 없음 — 예산 증액 재실행 가능 |
| `grounded-single-solver, reviewer-verified` | 인용된 모든 사실을 리뷰어가 재검증 완료 |
| `grounded-single-solver, partially-verified` | 일부 사실이 재현 불가(비싼 측정 등) — 해당 항목 명시됨 |
| `converged: false` / `unconverged-grounded` | 미수렴 — 답을 채택하지 않고 남은 findings와 함께 보고 |

미수렴의 가장 흔한 원인은 brief 결함입니다 — Phase 1로 돌아가 문제 서술을
고치는 게 정석입니다.

## 팁

- 문제를 던질 때 **제약 조건과 "유효한 답의 기준"을 함께** 주면 Phase 1이
  빨라집니다 (예: 물리 제약, 데이터 규모, 이미 확정된 결정).
- isolated는 solve당 max-effort 모델이라 비쌉니다. 잘 만든 brief는 2회 만에
  끝나고, 사실 확인이 주가 되는 문제는 grounded가 더 싸고 정확합니다.
- 두 증거 축이 모두 필요하면: grounded로 사실을 확정 → brief를 닫고 →
  isolated 재실행.
