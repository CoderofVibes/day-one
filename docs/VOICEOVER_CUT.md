# Voice script for the 2:07 submission cut

For Tony, reading over the cut you record from `/?video=1&cut=order&capture=1` (docs/RECORDING.md). One row per beat of `web/src/video.ts` (`ORDER_BEATS`): when it starts, how long it lasts, and the line to read. The captions stay on screen, so every line says the same as its caption and claims nothing more. Each line fits its beat at about 2.5 words a second, a normal speaking pace, with a breath to spare. Numbers are written the way to say them.

**How to record (Audacity):** one take per beat. Start a timer, read the line, stop. If a line runs past its seconds, read it a little faster or drop the words in brackets; never stretch the picture. Save each take as `01.wav`, `02.wav`, … by row. Claude lays each one under its beat and checks it ends inside it.

| # | Start | Beat | Seconds | Read |
|---|---|---|---|---|
| 1 | 0:00 | Day One at Hollow Pine | 11 | Acme just bought Hollow Pine. Ray still has a plant to run. Kevin's desk shows him what's handled and what needs him: batch records, weekend mail. |
| 2 | 0:11 | Bring over the old workbook | 9 | First, the plant's old inventory spreadsheet. Kevin reads it and flags duplicate lots, pounds, and numbers that don't agree. |
| 3 | 0:20 | Batch record in | 10 | Then the paper batch record. Kevin reads the scan and checks each quantity against the formula. Nothing posts until Ray confirms it. |
| 4 | 0:30 | Check stock across plants | 8 | Kevin also catches a transfer still on the other plant's books, and asks them to review the fix. |
| 5 | 0:38 | What production needs | 6 | The posted batch exposes a shortage in the next production run. |
| 6 | 0:44 | Quotes | 7 | Supplier agents send quotes. Kevin compares the qualified ones on price and delivery. |
| 7 | 0:51 | Carry the work into accounting | 8 | Order, receipt, invoice and payment line up in the mock ERP. Here's how NEAR enforces each handoff. |
| 8 | 0:59 | The refusal | 10 | Kevin's model approved a fifty-one-fifty order. The contract on NEAR testnet refused it: Kevin's limit is twenty-five hundred. |
| 9 | 1:09 | Approve by text | 10 | So it goes to Linda. In this demo her reply is simulated, and the server signs for her. Kevin's own key can't approve it. |
| 10 | 1:19 | Signed decision | 8 | The model's approval was signed in a hardware enclave. Linda's separate approval is what let Kevin fund the order. |
| 11 | 1:27 | Delivery | 6 | The truck arrives. Tommy checks the slip, and Kevin matches it to the order. |
| 12 | 1:33 | QC release, paid | 10 | Priya releases the lot, and the contract pays Northgate fifty-one fifty, in the demo's test token. Accounting sees it matched. |
| 13 | 1:43 | Verify the records | 8 | The records' fingerprints are on NEAR, so anyone can check a batch record [and trace a lot]. |
| 14 | 1:51 | Group buy | 9 | Plants that need the same ingredient buy it together. Each plant's director approves its own share. |
| 15 | 2:00 | Day One | 7 | Day One: from a paper batch record to an approved purchase, and a payment you can verify. |

**Words to keep out** (they claim more than the demo shows): autonomous, AI-run, audited, compliant, production-ready, real money, mainnet. Say "test token", "testnet", "simulated" and "mock ERP" where the caption does.

The older 2:15 take has its own script, `docs/VOICEOVER.md`; this one replaces it for the submission video.
