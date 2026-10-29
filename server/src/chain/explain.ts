// What went wrong in a live run, in plain words, and what to do about it. The contract's own
// refusals are already plain (CONTRACTS §4) and stay as they are; this explains the failures
// around them: the network, a missing key, an empty relayer, a PO id the contract has seen,
// a supplier on hold, the model service. It reads messages only; it never decides anything
// the contract decides.

export interface Explained {
  /** One sentence for the person at the screen. */
  what: string;
  /** What to do next. */
  fix: string;
}

const RULES: [RegExp, (m: RegExpExecArray) => Explained][] = [
  [
    /RPC endpoints? .* did not answer|fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|did not answer in \d+ s/i,
    () => ({
      what: "NEAR testnet did not answer, so nothing was sent.",
      fix: "Check the internet connection, or set NEAR_RPC_URL in .env to another testnet RPC; npm run preflight checks it. npm run demo replays the recorded run meanwhile.",
    }),
  ],
  [
    /no key for ([\w.-]+)/,
    (m) => ({
      what: `This computer has no key for ${m[1]}.`,
      fix: "Run npm run setup:testnet (it writes the server's keys to .near-credentials/testnet/).",
    }),
  ],
  [
    /(dayone-relayer\.testnet)[\s\S]*(NotEnoughBalance|LackBalanceForState|not enough balance)|(NotEnoughBalance|LackBalanceForState|not enough balance)[\s\S]*(dayone-relayer\.testnet)/i,
    () => ({
      what: "The relayer that pays the staff's gas is out of NEAR.",
      fix: "Top up dayone-relayer.testnet from the testnet faucet (a few NEAR is plenty); npm run preflight shows its balance.",
    }),
  ],
  [
    /NotEnoughBalance|LackBalanceForState|not enough balance/i,
    () => ({
      what: "The account that signs this step has too little NEAR to pay for it.",
      fix: "npm run preflight names the account and its balance; top it up from the testnet faucet.",
    }),
  ],
  [
    /(PO-[\w-]+) (?:was already submitted|is already on chain)/,
    (m) => ({
      what: `${m[1]} is already on the contract, and a PO id can be used once.`,
      fix: "A second live run needs a fresh contract: npm run reset:testnet -- --yes, then setup:testnet and deploy:testnet (DEMO_SCRIPT §4). The recorded run still replays with npm run demo.",
    }),
  ],
  [
    /([\w.-]+\.testnet) is suspended after (\d+) rejected deliveries/,
    (m) => ({
      what: `The contract holds ${m[1]} after ${m[2]} rejected deliveries in a row (each rehearsal rejects one).`,
      fix: "HQ reinstates the supplier (npm run rehearse prints the command), or run a live demo between rehearsals.",
    }),
  ],
  [
    /([\w.-]+\.testnet)'s supplier credential (expired|was revoked)/,
    (m) => ({
      what: `${m[1]}'s supplier credential ${m[2] === "expired" ? "has expired" : "was revoked"} on the contract.`,
      fix: "HQ renews it with npm run deploy:testnet (it issues the credentials CONTRACTS §8 lists).",
    }),
  ],
  [
    /([\w.-]+) is paused by HQ/,
    (m) => ({
      what: `HQ has paused ${m[1]} on the contract.`,
      fix: 'HQ resumes it: npm run policy -- "resume Kevin" --yes.',
    }),
  ],
  [
    /Plant budget is short by ([\d,.]+)/,
    (m) => ({
      what: `The plant budget on the contract is short by ${m[1]}.`,
      fix: "npm run deploy:testnet tops the budget up to 25,000 DTUSD when it is empty; otherwise HQ funds it.",
    }),
  ],
  [
    /AccessKeyDoesNotExist|access key .*(not found|does not exist)|MethodNameMismatch|ReceiverMismatch/i,
    () => ({
      what: "A signing key on this computer no longer matches the one on testnet.",
      fix: "Run npm run setup:testnet: it replaces a function-call key whose methods differ.",
    }),
  ],
  [
    /NEAR AI Cloud \d{3}|cloud-api\.near\.ai|insufficient credit|quota exceeded/i,
    () => ({
      what: "NEAR AI Cloud, where Kevin reads and reasons, did not answer this request.",
      fix: "Check NEARAI_API_KEY and its credit in .env (npm run preflight tries it); the step can be retried, nothing was sent to the chain.",
    }),
  ],
];

/** The plain explanation of a failure message, or null when it is not one we know. */
export function explainFailure(message: string | null | undefined): Explained | null {
  if (!message) return null;
  for (const [re, explain] of RULES) {
    const m = re.exec(message);
    if (m) return explain(m);
  }
  return null;
}
