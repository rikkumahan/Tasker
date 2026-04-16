import { redact } from '@arcjet/redact';
import fs from 'fs';
import path from 'path';

// STAGE 1: PRE-PASS REGEX VAULT
const SECRET_REGEXES = [
  { regex: /eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g, tag: "[ERASED_JWT]" },
  { regex: /AKIA[0-9A-Z]{16}/g,               tag: "[ERASED_API-KEY]" },
  { regex: /sk_live_[0-9a-zA-Z]{24}/g,        tag: "[ERASED_STRIPE-KEY]" },
  { regex: /ghp_[A-Za-z0-9]{36}/g,            tag: "[ERASED_GH-TOKEN]" },
  // 'token' is intentionally excluded — it's used as a trigger for JWTs which are caught by the eyJ regex first.
  // Capture group uses [^\s\.[  ] to stop at '[' so it does NOT swallow already-erased [ERASED_...] tags.
  { regex: /(?:\bpassword|\bpwd|\bsecret|\bkey|\bcode|\botp|\bverification|\blogin)[:\s=]+(?:is\s+)?(?![\[])([^\s\.[]+)/gi, tag: "[ERASED_PASSWORD]" },


  // ── INDIA HIGH-RISK IDENTITY PII (Permanent Erasure) ──
  // Aadhaar: 12-digit UID in 4+4+4 groups, space-separated.
  // Key guard: (?<![\d\-]) and (?![\-\d]) stop it matching inside 16-digit CC numbers.
  { regex: /(?<![\d\-])[2-9]\d{3} \d{4} \d{4}(?! \d)/g,        tag: "[ERASED_AADHAAR]" }, // space-separated
  { regex: /(?<![\d\-])[2-9]\d{11}(?![\d\-])/g,                 tag: "[ERASED_AADHAAR]" }, // solid 12 digits
  // PAN Card: 5 uppercase letters, 4 digits, 1 uppercase letter (e.g. ABCDE1234F)
  { regex: /\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b/g,  tag: "[ERASED_PAN]"   },
  // GSTIN: 15 chars — 2-digit state code + PAN + Z + checksum
  { regex: /\b[0-3][0-9][A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}\b/g, tag: "[ERASED_GSTIN]" },
  // IFSC Code: 4 uppercase bank letters + 0 + 6 alphanumeric chars
  { regex: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g,       tag: "[ERASED_IFSC]"  },
];


function prePassRedact(t){let o=t;for(const{regex,tag}of SECRET_REGEXES)o=o.replace(regex,tag);return o;}
function luhnValid(s){const d=s.replace(/\D/g,'').split('').map(Number);if(d.length<13||d.length>19)return false;let sum=0,e=false;for(let i=d.length-1;i>=0;i--){let x=d[i];if(e){x*=2;if(x>9)x-=9;}sum+=x;e=!e;}return sum%10===0;}

async function runEvaluation() {
  const evals = JSON.parse(fs.readFileSync(path.join(process.cwd(),'diagnostics','evals','pii_evals.json'),'utf8'));
  console.log("\n HIGH-FIDELITY PII ENGINE - EVAL SUITE (" + evals.length + " tests)\n");
  let passed = 0;
  for(const test of evals) {
    const s1 = prePassRedact(test.input);
    const res = await redact(s1, {
      entities: ['email','phone-number','ip-address','credit-card-number','credit-card','password'],
      detect: (tokens) => tokens.map((token,i) => {
        if(token.length>16){const freq={};for(let c of token)freq[c]=(freq[c]||0)+1;const h=Object.values(freq).reduce((a,n)=>{const p=n/token.length;return a-p*Math.log2(p);},0);if(h>4.5&&/[0-9]/.test(token)&&/[A-Z]/.test(token))return 'password';}
        if(/^[0-9\-]{13,19}$/.test(token)&&luhnValid(token)) return 'credit-card';
        return undefined;
      }),
      replace: e => '[ERASED_' + e.replace('credit-card-number','CREDIT-CARD').replace('credit-card','CREDIT-CARD').replace('phone-number','PHONE').replace('ip-address','IP').replace('email','EMAIL').toUpperCase() + ']'
    });
    const out = Array.isArray(res)?res[0]:(res.redacted||s1);
    let ok=true;
    for(const m of(test.expect_redacted_matches||[])) if(!out.includes(m)){ok=false;}
    for(const w of(test.expect_not_redacted||[])) if(!out.includes(w)){ok=false;}
    if(ok)passed++;
    console.log("["+test.id+"] "+(ok?'PASS':'FAIL'));
    if(!ok) console.log("  OUT: "+out);
  }
  console.log("\nSCORE: "+passed+"/"+evals.length+(passed===evals.length?' -- 100% ACCURACY!':' -- TUNING REQUIRED')+"\n");
}
runEvaluation();
