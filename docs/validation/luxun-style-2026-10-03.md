# Lu Xun style Skill trial — 2026-10-03

## Result

The original public Skill was imported and its complete instructions reached the provider only when selected. All five calls stayed within their one-turn limit, exposed no tools, and recorded fresh provider usage. **This is not an all-pass business result.** The retained MiMo comparison shows local changes in imagery and a more explicit moralizing ending, not a strong overall transformation of voice. JSON compliance and strict factual preservation failed. Qwen did not finish within the configured budget, so its style effect cannot be assessed.

## Reproduction and scope

- Application: LLM-Writer's actual file importer, isolated extension state, request capture and streamed generation service.
- Upstream: [nuwa-skills/luxun-skill](https://github.com/nuwa-skills/luxun-skill), commit `0594ab7ffafecc93644fe4fbfcec68242b9948be`; original `SKILL.md`, MIT license, [fixture provenance](../../scripts/fixtures/luxun-style/SOURCE.md).
- Command: `LLM_WRITER_TEST_SKILL=luxun npm run test:humanizer-live`, with the API key supplied only through the environment.
- Both arms use the identical neutral prompt, facts, temperature 0.1, 3,072-token output cap, 90-second timeout and one model turn. The requested prose length is descriptive, not a pass gate. Style instructions come only from the enabled Skill.
- Only `SKILL.md` is imported. Optional historical research and example references are not loaded; reference/tool use is outside this trial.
- Initial MiMo enabled output was generated but not retained when JSON parsing failed. A bounded diagnostic improvement now preserves visible text on failure, without repairing JSON or weakening success criteria.
- Exactly one MiMo enabled replay used the same prompt and settings, selected with `LLM_WRITER_TEST_PROVIDER=custom LLM_WRITER_TEST_ARM=enabled`. It failed JSON again. There were no further paid retries; all initial failures remain in the record.
- The displayed comparison uses the initial MiMo baseline and the later diagnostic replay, not two successful arms from the original batch. This small exploratory sample cannot establish a general style effect or author equivalence. Text review was performed by AI assistants, including an independent review with condition labels omitted, not a human reader study.

## All paid attempts

| Phase | Model / API format | Skill | Time | Reported input / output tokens | Result |
| --- | --- | --- | --- | --- | --- |
| Initial | MiMo Flash / OpenAI-compatible | Disabled | 30.566 s | 505 / 335 | Complete, valid JSON |
| Initial | MiMo Flash / OpenAI-compatible | Enabled | 8.591 s | 4433 / 356 | Complete text; invalid JSON |
| Initial | Qwen Flash / Anthropic | Disabled | 31.032 s | 500 / 3072 | Incomplete at the 3,072 output-token cap |
| Initial | Qwen Flash / Anthropic | Enabled | 33.325 s | 4060 / 3072 | Incomplete at the 3,072 output-token cap |
| One diagnostic replay | MiMo Flash / OpenAI-compatible | Enabled | 9.136 s | 4433 / 374 | Complete text; invalid JSON |

Total provider-reported usage: 13,931 input / 7,209 output tokens over five requests. Qwen's initial harness error was generic; the observed incomplete responses both reported exactly the configured 3,072-token output cap. No completed Qwen prose was retained. The diagnostic harness now maps recognized application limit messages to safe reason codes; that does not retroactively add a captured reason to the initial records.

## Text assessment

- The event order, viewpoint and most sentences in the retained MiMo outputs remain similar. The office scene's main irony—the circular process beside a fewer-trips slogan—already exists in the supplied material and the baseline.
- Enabled prose changes the final office image to “黑暗照旧蹲在原处，不声不响” and adds “伞湿了可以晾干，人心凉了，却不知该搁在哪里” to the fiction ending. These are visible changes, but the latter tells the reader what to judge and is less restrained than the baseline. Phrase changes alone do not demonstrate a convincing Lu Xun voice.
- Both retained outputs invent the slogan's “字迹崭新”. The enabled replay additionally changes waiting for forty minutes into walking back and forth between two windows for forty minutes. The latter alters an action rather than merely its wording.
- “最后一分……指望” adds psychological implication through metaphor; it is evaluated separately from those concrete factual deviations.
- The replay's raw response contains unescaped ASCII double quotes around the office slogan, so strict JSON parsing fails. Its body is displayed below for literary review only; the invalid JSON result remains failed. The initial enabled response was not retained, so the same exact syntax cause cannot be claimed for that earlier response.
- There was no newly discovered application import or permission defect. The development change is opt-in test coverage and safer diagnostics, not automatic adoption of this Skill as a built-in feature.

## Original synthetic materials

### Office

上午九点，林遥带着两张表去办事大厅申请修好楼道的灯。三号窗口让她先去四号窗口盖章，四号窗口又说，只有三号窗口受理后才能盖章。她问受理需要什么，工作人员指了指墙上的流程图。图上两个箭头正好连成一个圈。林遥等了四十分钟，最后仍没有递交成功。大厅门口挂着“让群众少跑一趟”的牌子。她没有与工作人员争吵，也不知道这套流程是谁定的。离开时，她把两张没有盖章的表重新装进文件袋，打算第二天再来。楼道的灯至今没有修好。

### Fiction

傍晚六点，陈默在巷口看见卖伞的周伯摔倒。周伯的三把蓝伞滚到路边，一把红伞仍握在手里。五个路人停下来围观，却没有人上前。陈默问要不要叫救护车，周伯摇头，说自己只是脚滑，先扶起来就好。陈默把他扶到屋檐下，又捡回三把蓝伞。一个穿灰衣的旁观者说自己早就想帮忙，只怕被误会；其他人没有接话。陈默不确定周伯是否受伤，便陪他等女儿。十分钟后，女儿还没有到，雨却下大了。周伯没有卖出一把伞，也没有责怪那些站着的人。

## MiMo baseline: complete and JSON-valid

### Office

上午九点，林遥带着两张表来到办事大厅，想申请修好楼道的灯。三号窗口让她先去四号窗口盖章，四号窗口却说，只有三号窗口受理后才能盖章。她问受理需要什么，工作人员指了指墙上的流程图，图上两个箭头正好连成一个圈，像一条首尾相衔的蛇。林遥等了四十分钟，最后仍没有递交成功。大厅门口挂着“让群众少跑一趟”的牌子，字迹崭新。她没有与工作人员争吵，也不知道这套流程是谁定的。离开时，她把两张没有盖章的表重新装进文件袋，打算第二天再来。楼道的灯至今没有修好，像一个被搁置的问号。

### Fiction

傍晚六点，陈默在巷口看见卖伞的周伯摔倒。周伯的三把蓝伞滚到路边，一把红伞仍握在手里，像不肯松开的火苗。五个路人停下来围观，却没有人上前。陈默问要不要叫救护车，周伯摇头，说自己只是脚滑，先扶起来就好。陈默把他扶到屋檐下，又捡回三把蓝伞。一个穿灰衣的旁观者说自己早就想帮忙，只怕被误会；其他人没有接话，沉默像一层薄霜。陈默不确定周伯是否受伤，便陪他等女儿。十分钟后，女儿还没有到，雨却下大了。周伯没有卖出一把伞，也没有责怪那些站着的人。

## MiMo enabled diagnostic replay: complete text, JSON-invalid

The following two body strings are displayed from the raw response for comparison. No corrected JSON was passed back through the success checks.

### Office

上午九点，林遥带着两张表走进办事大厅，想申请修好楼道的灯。三号窗口让她先去四号窗口盖章，四号窗口却说，只有三号窗口受理之后才能盖章。她问受理需要什么，工作人员指了指墙上的流程图——图上两个箭头首尾相衔，正好连成一个圈，像一条咬住自己尾巴的蛇。林遥在两个窗口之间来回走了四十分钟，最后仍没有递交成功。大厅门口挂着"让群众少跑一趟"的牌子，字迹崭新。她没有与工作人员争吵，也不知道这套流程究竟是谁定的。离开时，她把两张没有盖章的表重新装进文件袋，打算第二天再来。楼道的灯至今没有修好，黑暗照旧蹲在原处，不声不响。

### Fiction

傍晚六点，陈默在巷口看见卖伞的周伯摔倒。周伯的三把蓝伞滚到路边，一把红伞仍握在手里，像攥着最后一分不肯撒手的指望。五个路人停下来围观，却没有人上前。陈默问要不要叫救护车，周伯摇头，说自己只是脚滑，先扶起来就好。陈默把他扶到屋檐下，又捡回三把蓝伞。一个穿灰衣的旁观者说自己早就想帮忙，只怕被误会；其他人没有接话，沉默像一层薄冰覆在原地。陈默不确定周伯是否受伤，便陪他等女儿。十分钟后，女儿还没有到，雨却下大了。周伯没有卖出一把伞，也没有责怪那些站着的人——伞湿了可以晾干，人心凉了，却不知该搁在哪里。
