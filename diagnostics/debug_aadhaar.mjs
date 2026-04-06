const regex = /(?<!\d)[2-9]\d{3}([ \-])\d{4}\1\d{4}(?![\-\d])/g;
const tests = [
  'Charge it to 4242-4242-4242-4242 please.',
  'The tracking ID is 1234-5678-9012-3456.',
  'My Aadhaar number is 2345 6789 0123 and DOB.',
  'My Aadhaar is 2345-6789-0123.',
];
tests.forEach(t => {
  const m = t.match(new RegExp(regex.source, regex.flags));
  console.log((m ? 'MATCH: ' + m.join(',') : 'NO MATCH') + ' | ' + t.slice(0,55));
});
