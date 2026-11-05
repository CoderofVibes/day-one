# Voice-over script (2:15 take)

For Tony, reading over the silent screen take (docs/RECORDING.md §4). Each block is one beat of `web/src/video.ts`: its start time, how long it lasts, and the words, which are the captions burned in on screen, so the voice and the picture say the same thing. Most beats read at 2 to 3 words a second, a normal speaking pace; seven run faster, and each has a shorter spoken line below. A pause is marked `/`.

Record it in Clipchamp while the take plays, one beat at a time if that is easier, and line each block up with its start time. If a beat runs long in your voice, shorten the spoken line, not the caption: the caption is the claim, checked against the code.

| Start | Beat | Seconds | Read |
|---|---|---|---|
| 0:00 | Before | 10 | For ten years this was my job. / Read the batch record. / Type every gram into the ERP. / Hope the other plant typed theirs right. |
| 0:10 | Title | 6 | This is Kevin. He's an AI assistant the new owners send in on day one. |
| 0:16 | Kevin's desk | 9 | Ray starts his day on Kevin's desk: what Kevin already handled, and what needs Ray. / Overnight, Kevin drafted replies for Ray to sign, and refused a new-bank-details email. |
| 0:25 | Batch record in | 12 | Ray uploads the batch record. / Kevin reads it, checks it against the formula, / and asks before he changes anything. |
| 0:37 | One truth | 8 | Kevin catches what the other plant got wrong, / and proposes a fix instead of overwriting it. |
| 0:45 | Quotes | 10 | He asks the supplier agents for quotes. / The cheapest one isn't qualified, so Kevin won't buy from them. |
| 0:55 | The refusal | 10 | Kevin isn't allowed to spend that much. Not by a setting in our app. / The rule lives on NEAR, and the chain itself said no. / So the order becomes one decision for Linda. |
| 1:05 | Approve by text | 10 | Linda approves from her phone. / In this replay her text is simulated, and signed with the director's account. / Kevin's account can't approve it, and Linda never touches a wallet. |
| 1:15 | Signed decision | 8 | Kevin's model signed its approval in a secure enclave, for this exact order. / But a signature isn't permission: it was refused until Linda said yes. |
| 1:23 | Delivery | 8 | The truck shows up. Tommy checks in the packing slip, / Kevin matches it to the PO, and the lot goes to quarantine. |
| 1:31 | New bank details | 8.5 | Then an invoice arrives saying Northgate's bank details changed. Kevin holds it. / Even if he hadn't, the money can only go to the account the order was funded for. |
| 1:39 | QC release → paid | 10 | Priya releases the lot. / The supplier is paid that second, for what was counted in, not in net-30. / Accounting sees it matched and paid. |
| 1:49 | The numbers reconcile | 8 | Material in, batches out, waste claimed: it all has to add up. / When a plant's waste doesn't, Kevin tells HQ. |
| 1:57 | Behind the curtain | 11 | Underneath, everyone is a NEAR account. Kevin's key can only ask; the contract decides. / Staff hold zero tokens; Day One pays their gas. / Every lot's records are anchored on chain, so nobody can quietly edit history. |
| 2:08 | Close | 7 | Kevin does the purchasing work. / The contract enforces the limits HQ sets, / and every recorded payment traces to its order. |

**Tight beats: shorter spoken lines.** These beats carry more than 3 words a second if read in full. The caption stays on screen either way, so the shorter line loses nothing a viewer cannot read.

| Beat | Full | Short read |
|---|---|---|
| Kevin's desk | 3.2 w/s | Ray starts his day on Kevin's desk. / Overnight, Kevin drafted replies for Ray to sign, and refused a new-bank-details email. |
| The refusal | 3.5 w/s | Kevin isn't allowed to spend that much, and that's not an app setting. / The rule lives on NEAR, and the chain said no. / So it goes to Linda. |
| Approve by text | 3.1 w/s | Linda approves from her phone; in this replay, her text is simulated. / Kevin can't approve it, and Linda never touches a wallet. |
| Signed decision | 3.3 w/s | Kevin's model signed its approval for this exact order. / But a signature isn't permission: only Linda's yes funded it. |
| New bank details | 3.5 w/s | An invoice says Northgate's bank details changed. Kevin holds it. / And the money can only go to the account the order was funded for. |
| Behind the curtain | 3.5 w/s | Underneath, everyone is a NEAR account. The contract decides. / Staff hold no tokens. / And every lot's records are anchored on chain. |
| Close | 3.1 w/s | Kevin does the work. The contract enforces the limits. / Every payment traces to its order. |

**Words to say plainly:** "NEAR" as the word *near*. "PO" as *P-O*. "Net-30" as *net thirty*. "QC" as *Q-C*.

**What not to add in the voice:** no numbers beyond the captions, no "secure" or "guaranteed" claims beyond them, and no real company or person. The director's reply is simulated in this replay; the caption says so, and the voice should too.
