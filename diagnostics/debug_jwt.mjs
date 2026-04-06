const jwt = /eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g;
const labeled = /(?:\bpassword|\bpwd|\bsecret|\bkey|\bcode|\btoken|\botp|\bverification|\blogin)[:\s=]+(?:is\s+)?(?![\[])([^\s\.]+)/gi;
let text = 'Your token is eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoyNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c.';
// CORRECT ORDER: JWT first (already how our array is ordered)
text = text.replace(jwt, '[ERASED_JWT]');
console.log('After JWT pass:', text.slice(0,60));
text = text.replace(labeled, '[ERASED_PASSWORD]');
console.log('Final:', text);
