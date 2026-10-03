# Fountain format Skill trial — 2026-10-03

## Result

**The selected Skill visibly changed the output format in this two-call trial.** With the same neutral prompt, MiMo Flash produced two prose sections without the Skill and a two-scene Fountain screenplay with it. All seven predeclared fixture-format checks passed for the enabled arm. Both calls completed, preserved the four dialogue lines verbatim, recorded fresh usage, and exposed no tools.

Core plot review confirmed character identities, handoff direction, action order, night-to-dawn sequence, locations and the unopened blue envelope. The enabled output added one unsupported environment detail: “候车室里灯光昏暗”. Thus format compliance passed, while strict source-only fidelity is not perfect. “天色微明” is consistent with the supplied dawn setting. A second AI assistant independently agreed with this assessment; this was not a human reader study.

## Conditions

- Original [NolanX screenplay-fountain-format Skill](https://github.com/nolanx-ai/nolanx.ai/blob/595d86364377f654e24ddf2c9e875496d85e8246/.nolanx/skills/screenplay-fountain-format/SKILL.md), MIT, pinned to `595d86364377f654e24ddf2c9e875496d85e8246`.
- Byte-exact `SKILL.md` SHA256: `aa2ccbd193e786b577100aa474fea8e0a1459d1f699b0e4862430d97dee33793`. [Fixture provenance](../../scripts/fixtures/screenplay-fountain-format/SOURCE.md).
- Actual application file import, isolated extension settings, selected-Skill request capture and streamed generation. Full original instructions were observed in outgoing system context only in the enabled arm.
- Shared prompt: “请根据以下场景素材整理成一份可直接使用的稿件。保持角色姓名、全部对白逐字不变，以及地点、时间、蓝色信封未拆封和动作先后关系。不要新增人物或事件。只返回稿件，不要解释。” It mentions neither Fountain nor JSON and supplies no format example.
- Model: `mimo-v2.6-flash` through OpenCode Go's OpenAI-compatible endpoint; temperature 0.1, thinking disabled, 3,072 maximum output tokens, 90-second timeout, one turn each. Exactly two paid calls, no retries. This trial does not establish Anthropic-format performance.
- Invocation: `LLM_WRITER_TEST_SKILL=fountain LLM_WRITER_TEST_PROVIDER=custom npm run test:humanizer-live`, with the key supplied only through the environment.
- Checks use the [official Fountain syntax](https://fountain.io/syntax/) for a declared fixture subset: two scene headings, heading whitespace, interior then exterior, night then dawn, four uppercase cues in source order, cue whitespace, and immediately following exact dialogue. This is not a complete Fountain grammar validator. One presentation fence, forced `@` cues and paired quotation delimiters were allowed before calling the model; neither result needed these allowances.
- The neutral baseline was not asked for Fountain, so its format-check failures demonstrate a difference rather than a baseline task failure. The enabled arm must pass the format checks. No model output was repaired or reformatted to pass.

## Observed results

| Measurement | Disabled | Enabled |
| --- | --- | --- |
| Completion and reported usage | Pass | Pass |
| Time | 3.817 s | 4.720 s |
| Input / output tokens | 252 / 110 | 549 / 139 |
| Scene headings | 0 | 2 |
| Character cue blocks | 0 | 4 |
| Fixture-format checks | 0 / 7 | 7 / 7 |
| Four dialogue lines retained | Yes | Yes |
| Tool calls | 0 | 0 |

Total reported usage: 801 input / 249 output tokens. The full Skill added 297 input tokens in this trial. These timings and counts are observations from one pair, not a latency benchmark or broad reliability estimate.

## Original synthetic material

第一段发生在夜里的车站候车室。MAYA把一个未拆封的蓝色信封递给LEON，说：“天亮前别打开。”LEON将信封放进外套内袋，回答：“我会在北侧站台等你。”第二段发生在次日黎明的北侧站台。LEON站在站牌下，手里仍拿着未拆封的蓝色信封。MAYA走来，问：“你打开过吗？”LEON摇头，回答：“没有。”

## Disabled: unmodified model output

```text
**第一段**

夜里的车站候车室。

MAYA把一个未拆封的蓝色信封递给LEON，说：“天亮前别打开。”

LEON将信封放进外套内袋，回答：“我会在北侧站台等你。”

**第二段**

次日黎明的北侧站台。

LEON站在站牌下，手里仍拿着未拆封的蓝色信封。

MAYA走来，问：“你打开过吗？”

LEON摇头，回答：“没有。”
```

## Enabled: unmodified model output

```fountain
INT. 车站候车室 - 夜

候车室里灯光昏暗。MAYA 把一个未拆封的蓝色信封递给 LEON。

MAYA
天亮前别打开。

LEON 将信封放进外套内袋。

LEON
我会在北侧站台等你。

EXT. 北侧站台 - 黎明

天色微明。LEON 站在站牌下，手里仍拿着未拆封的蓝色信封。

MAYA 走来。

MAYA
你打开过吗？

LEON 摇头。

LEON
没有。
```
