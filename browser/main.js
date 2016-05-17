const regenerator = require('../main');
const VM = require('../runtime/vm');
const CodeMirror = require('codemirror');

require('codemirror/mode/javascript/javascript.js');
require('codemirror/lib/codemirror.css');
require('codemirror/theme/monokai.css');
require('./style.css');

var template = document.querySelector('#template').innerHTML;
window.debuggerDemo = {
  listeners: {},
  on: function(event, callback) {
    if(!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  },

  fire: function(event, vm, arg) {
    if(this.listeners[event]) {
      this.listeners[event].forEach(cb => {
        cb(vm, arg)
      });
    }
  }
};

var errorTimer;
function showError(e) {
  var errorNode = document.querySelector("#debugger-error");

  if(errorNode) {
    errorNode.textContent = 'Error: ' +  e.message;
    errorNode.style.display = "block";

    if(errorTimer) {
      clearTimeout(errorTimer);
    }

    errorTimer = setTimeout(function() {
      errorNode.style.display = 'none';
    }, 5000);
  }
}

function initDebugger(node) {
  var code = node.textContent;
  var breakpoint = node.dataset.breakpoint;
  var id = node.id;

  if(!id) {
    throw new Error("debugger does not have an id");
  }

  var container = document.createElement('div');
  container.className = "debugger";
  container.innerHTML = template;
  node.parentNode.replaceChild(container, node);

  // Don't judge me
  setTimeout(() => finishInit(code, breakpoint, container, id), 10);
}

function finishInit(code, breakpoint, container, id) {
  const pausedBtns = container.querySelector('#paused');
  const resumedBtns = container.querySelector('#resumed');
  const stackEl = container.querySelector('#actual-stack');
  const outputEl = container.querySelector('#actual-output');

  const mirror = CodeMirror(container.querySelector('#editor'), {
    mode: 'javascript',
    theme: 'monokai',
    value: code,
    lineNumbers: true,
    gutters: ['breakpoints']
  });

  const vm = new VM.$Machine();
  let currentPausedLoc = null;
  let currentExprHighlight = null;
  let breakpoints = [];

  if(breakpoint) {
    const line = parseInt(breakpoint);
    breakpoints.push(line);
    mirror.setGutterMarker(line - 1, 'breakpoints', marker());
  }

  function marker() {
    let marker = document.createElement("div");
    marker.className = "breakpoint";
    return marker;
  }

  function exprHighlight(width, charHeight) {
    let h = document.createElement("div");
    h.className = "expr-highlight";
    h.style.width = width + "px";
    h.style.height = charHeight + "px";
    // CodeMirror puts the widget *below* the line, but we actually
    // want it to cover the indicated line, so move it up a line
    h.style.marginTop = -charHeight + "px";
    return h;
  }

  function removePauseState() {
    if(currentPausedLoc) {
      for(var i = currentPausedLoc.start.line; i <= currentPausedLoc.end.line; i++) {
        mirror.removeLineClass(i - 1, 'line', 'debug');
      }
      currentPausedLoc = null;
    }

    if(currentExprHighlight) {
      currentExprHighlight.parentNode.removeChild(currentExprHighlight);
      currentExprHighlight = null;
    }

    updateUI();
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

  mirror.on('beforeChange', () => {
    breakpoints.forEach(line => {
      mirror.setGutterMarker(line - 1, 'breakpoints', null);
    });
    breakpoints = [];

    vm.abort();
    removePauseState();
  });

  vm.on("error", function(e) {
    console.log('Error:', e, e.stack);
    showError(e);
  });

  vm.on("paused", function(e) {
    currentPausedLoc = vm.getLocation();
    if(currentPausedLoc) {
      for(var i = currentPausedLoc.start.line; i <= currentPausedLoc.end.line; i++) {
        mirror.addLineClass(i - 1, 'line', 'debug');
      }

      if(currentExprHighlight) {
        currentExprHighlight.parentNode.removeChild(currentExprHighlight);
        currentExprHighlight = null;
      }

      if(currentPausedLoc.start.line === currentPausedLoc.end.line) {
        var width = currentPausedLoc.end.column - currentPausedLoc.start.column;
        currentExprHighlight = exprHighlight(mirror.defaultCharWidth() * width,
                                             mirror.defaultTextHeight())

        mirror.addWidget(
          { line: currentPausedLoc.start.line - 1,
            ch: currentPausedLoc.start.column },
          currentExprHighlight,
          false
        );
      }

      mirror.scrollIntoView(
        { from: { line: currentPausedLoc.start.line, ch: 0 },
          to: { line: currentPausedLoc.end.line, ch: 0 } },
        50
      );
    }

    updateUI();
  });

  vm.on("resumed", function() {
    removePauseState();
  });

  // vm.on("cont-invoked", function() {
  // });

  vm.on("finish", () => {
    updateUI();
  });

  function updateUI() {
    if(currentPausedLoc) {
      resumedBtns.style.display = 'none';
      pausedBtns.style.display = 'block';
    }
    else {
      resumedBtns.style.display = 'block';
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

  container.querySelector('#step').addEventListener('click', function() {
    vm.step();
  });

  container.querySelector('#continue').addEventListener('click', function() {
    vm.continue();
  });

  container.querySelector('#run').addEventListener('click', function() {
    vm.abort();

    const code = mirror.getValue();
    outputEl.textContent = '';
    try {
      vm.loadString(mirror.getValue());
    }
    catch(e) {
      debuggerDemo.fire("error", vm, e);
      showError(e);
    }

    breakpoints.forEach(line => {
      vm.toggleBreakpoint(line);
    });

    vm.run();
  });

  container.querySelector('#run-no-breakpoints').addEventListener('click', function() {
    vm.abort();

    const code = mirror.getValue();
    outputEl.textContent = '';
    vm.loadString(mirror.getValue());

    vm.run();
  });
}

var debuggers = document.querySelectorAll(".debugger");
for(var i=0; i<debuggers.length; i++) {
  initDebugger(debuggers[i]);
}
