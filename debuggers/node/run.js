#!/usr/bin/env node

var Machine = require('../../runtime/vm.js').$Machine;
var VM = new Machine();

VM.on("error", function(e) {
  console.log('Error:', e.stack);
});

function repl() {
  console.log("REPL");
  showPrompt();
  process.stdin.on('data', onInput);
}

function onInput(text) {
  text = text.trim();
  if(text === ",c") {
    process.stdin.removeListener('data', onInput);
    process.stdin.unref();
    VM.continue();
  }
  else {
    console.log(VM.evaluate(text));
    showPrompt();
  }
};

function showPrompt() {
  console.log(VM.getLocation());
  process.stdout.write(
    // loc.start.line + ':' +
    // loc.start.column +
    '> '
  );
}

process.stdin.setEncoding('utf8');

VM.on('breakpoint', repl);
VM.loadScript(process.argv[2]);
