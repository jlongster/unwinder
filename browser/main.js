const regenerator = require('../main');
const VM = require('../runtime/vm');
const CodeMirror = require('codemirror');

require('codemirror/mode/javascript/javascript.js');
require('codemirror/lib/codemirror.css');
require('codemirror/theme/monokai.css');

const defaultCode = `
function foo(x) {
  if(x <= 0) {
    return x;
  } else {
    return x + foo(x - 1);
  }
}

console.log(foo(3));`;

const mirror = CodeMirror(document.querySelector('#editor'), {
  mode: 'javascript',
  theme: 'monokai',
  value: defaultCode.replace(/\t/g, ''),
  lineNumbers: true,
  gutters: ['breakpoints']
});

const runBtn = document.querySelector('#run');
const pausedBtns = document.querySelector('#paused');
const stackEl = document.querySelector('#stack');
const outputEl = document.querySelector('#actual-output');

const vm = new VM.$Machine();
let currentPausedLoc = null;
let breakpoints = [];

function marker() {
  let marker = document.createElement("div");
  marker.className = "breakpoint";
  return marker;
}

mirror.on('gutterClick', (inst, line) => {
  line = line + 1;
  if(breakpoints.indexOf(line) === -1) {
    breakpoints.push(line);
    mirror.setGutterMarker(line - 1, 'breakpoints', marker());
  }
  else {
    breakpoints = breakpoints.filter(l => l !== line);
    mirror.setGutterMarker(line - 1, 'breakpoints', null);
  }

  if(vm.state === 'suspended') {
    vm.toggleBreakpoint(line);
  }
});

vm.on("error", function(e) {
  console.log('Error:', e, e.stack);
});

vm.on("paused", function(e) {
  currentPausedLoc = vm.getLocation();
  if(currentPausedLoc) {
    mirror.addLineClass(currentPausedLoc.start.line - 1, 'line', 'debug');
  }

  updateUI();
});

vm.on("resumed", function() {
  mirror.removeLineClass(currentPausedLoc.start.line - 1, 'line', 'debug');
  currentPausedLoc = null;

  updateUI();
});

vm.on("finish", updateUI);

function updateUI() {
  if(currentPausedLoc) {
    runBtn.style.display = 'none';
    pausedBtns.style.display = 'block';
  }
  else {
    runBtn.style.display = 'block';
    pausedBtns.style.display = 'none';
  }

  if(vm.stack) {
    stackEl.innerHTML = '<ul>' +
      vm.stack.map(frame => {
        return '<li>' + frame.name + '</li>';
      }).join('') +
      '</ul>';
  }
  else {
    stackEl.innerHTML = '';
  }

  outputEl.textContent = vm.getOutput();
}

document.querySelector('#step').addEventListener('click', function() {
  vm.step();
});

document.querySelector('#continue').addEventListener('click', function() {
  vm.continue();
});

runBtn.addEventListener('click', function() {
  const code = mirror.getValue();
  vm.loadString(mirror.getValue());

  breakpoints.forEach(line => {
    vm.toggleBreakpoint(line);
  });

  vm.run();
});
