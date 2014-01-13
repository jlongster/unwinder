
// util

function classes() {
  return Array.prototype.slice.call(arguments).reduce(function(acc, cls) {
    if(cls) {
      acc.push(cls);
    }
    return acc;
  }, []).join(' ');
}

// main.js is exported from browserify
var probejs = { compile: main.js };
var dom = React.DOM;

var App = React.createClass({
  getInitialState: function() {
    return { source: null,
             toolsetOpen: true };
  },

  componentDidMount: function() {
    $.get('src.txt', function(res) {
      this.setState({ source: res });
    }.bind(this));

    VM.onBreakpoint = function() {
      this.openToolset('debugger');
      this.refs.toolset.getTool('debugger').printReport();
    }.bind(this);
  },

  handleSourceChange: function(src) {
    VM.reset();
    this.refs.editor.highlight(null);
    this.setState({ source: src });
  },

  run: function() {
    var consoleTool = this.refs.toolset.getTool('console');
    consoleTool.clear();

    try {
      var src = probejs.compile(this.refs.editor.getValue());
    }
    catch(e) {
      consoleTool.log(e.toString());
      return;
    }

    this.setState({
        displayValue: src
    });

    // var display = this.refs.display.getDOMNode();
    // var canvas = display.querySelector('canvas');
    var canvas = null;

    var func = new Function(
      'VM', 'invokeRoot', 'invokeMethod', 'console', 'canvas',
      src
    );

    try {
      func(VM, invokeRoot, invokeFunction,
           consoleTool.getConsoleObject(),
           canvas);
    }
    catch(e) {
      this.openToolset('debugger');
      this.refs.toolset.getTool('debugger').handleError(e);
    }

    consoleTool.flush();
  },

  toggleToolset: function(tool) {
    this.setState({ toolsetOpen: !this.state.toolsetOpen });
  },

  openToolset: function() {
    this.setState({ toolsetOpen: true });
    this.refs.toolset.tool('debugger');
  },

  closeToolset: function() {
    this.setState({ toolsetOpen: false });
  },

  render: function() {
    return dom.div(
      { className: 'app' },
      dom.div(
        { className: 'app-inner' },
        Editor({
          ref: 'editor',
          className: ('col col-sm-6 left ' +
                      (this.state.toolsetOpen ? 'partial' : 'full')),
          value: this.state.source,
          onChange: this.handleSourceChange
        }),
        Display({ ref: 'display',
                  className: ('col col-sm-6 right ' +
                              (this.state.toolsetOpen ? 'partial' : 'full')),
                  value: this.state.displayValue }),
        Toolset({ className: this.state.toolsetOpen ? '' : 'hidden',
                  ref: 'toolset',
                  onClose: this.closeToolset,
                  getEditor: function() {
                    return this.refs.editor;
                  }.bind(this)})
      ),
      Footer({ onRun: this.run,
               toolsetOpen: this.state.toolsetOpen,
               onToggleToolset: this.toggleToolset })
    );
  }
});

var Editor = React.createClass({
  componentDidMount: function(root) {
    var mirror = CodeMirror(root, {
      value: this.props.value || '',
      mode: 'javascript',
      theme: 'ambiance',
      lineNumbers: true,
      gutters: ["CodeMirror-linenumbers", "breakpoints"],
      autofocus: true
    });

    mirror.on("gutterClick", function(cm, n) {
      var info = cm.lineInfo(n);
      cm.setGutterMarker(n, "breakpoints",
                         info.gutterMarkers ? null : makeMarker());
    });

    mirror.on("change", function() {
      if(this.props.onChange) {
        this.props.onChange(mirror.getValue());
      }
    }.bind(this));

    function makeMarker() {
      var marker = document.createElement("div");
      marker.style.color = "#822";
      marker.innerHTML = "●";
      return marker;
    }

    this._editor = mirror;
    this._onResize = function() {
      var rect = root.getBoundingClientRect();
      // HACK: take 20px off to account for padding
      var h = rect.height - 20;
      mirror.setSize(null, h);
    };

    this._onResize();
    $(window).on('resize', this._onResize);
  },

  componentWillUnmount: function() {
    $(window).off('resize', this._onResize);
  },

  getValue: function() {
    return this._editor.getValue();
  },

  componentDidUpdate: function(prevProps) {
    if(this.props.value !== this._editor.getValue()) {
      this._editor.setValue(this.props.value || '');
    }

    this._onResize();

    if(VM.state === VM.SUSPENDED) {
      this.highlight(VM.getLoc());
    }
  },

  highlight: function(loc) {
    var editor = this._editor;

    if(this._lastMarker) {
      this._lastMarker.clear();
    }

    if(loc) {
      this._lastMarker = editor.markText(
        { line: loc.start.line - 1,
          ch: loc.start.column },
        { line: loc.end.line - 1,
          ch: loc.end.column },
        { className: 'highlight' }
      );

      var pos = editor.cursorCoords({ line: loc.start.line - 1,
                                      ch: loc.start.column },
                                    'local');
      editor.scrollIntoView({ top: pos.top - 40,
                              left: pos.left,
                              bottom: pos.bottom + 40 });
    }
  },

  render: function() {
    var cls = ['editor', this.props.className || ''].join(' ');
    return dom.div({ className: cls });
  }
});

var Display = React.createClass({
  render: function() {
    var cls = ['display', this.props.className || ''].join(' ');
    return dom.div(
      { className: cls },
      dom.div({ className: 'inner' },
              this.props.value)
    );
  }
});

var Toolset = React.createClass({
  getInitialState: function() {
    return { openTool: 'debugger' };
  },

  tool: function(tool) {
    this.setState({ openTool: tool });
  },

  getTool: function(tool) {
    return this.refs[tool];
  },

  render: function() {
    var cls = ['toolset', this.props.className || ''].join(' ');

    var activeClass = function(tool, cls) {
      return this.state.openTool == tool ? cls : null;
    }.bind(this);

    return dom.div(
      { className: cls },
      dom.button({ className: 'close',
                   onClick: this.props.onClose }, 'x'),
      dom.ul(
        { className: 'nav nav-tabs' },
        dom.li({ className: activeClass('debugger', 'active') },
               dom.a({ onClick: this.tool.bind(this, 'debugger') },
                     "DEBOOGER")),
        dom.li({ className: activeClass('console', 'active') },
               dom.a({ onClick: this.tool.bind(this, 'console') },
                     "CONSOLE"))
      ),
      Debugger({ ref: 'debugger',
                 className: classes('debugger', activeClass('debugger', 'show')),
                 onClose: this.closeTool,
                 getConsole: this.getTool.bind(this, 'console'),
                 getEditor: this.props.getEditor }),
      Console({ ref: 'console',
                className: classes('console',
                                   activeClass('console', 'show'),
                                   activeClass('debugger', 'show with-debugger')),
                onClose: this.closeTool })
    );
  }
});

var Debugger = React.createClass({
  getInitialState: function() {
    return { output: '',
             stack: '' };
  },

  componentDidMount: function() {
    VM.onStep = function() {
      this.props.getEditor().highlight(VM.getLoc());
      this.printReport();
    }.bind(this);

    VM.onFinish = function() {
      this.props.getEditor().highlight(null);
    }.bind(this);
  },

  continue: function() {
    try {
      VM.getCurrentFrame().run();
    }
    catch(e) {
      this.handleError(e);
      return;
    }

    this.props.getConsole().flush();
  },

  step: function() {
    try {
      VM.getCurrentFrame().step();
    }
    catch(e) {
      this.handleError(e);
      return;
    }

    this.props.getConsole().flush();
  },

  handleError: function(e) {
    if(VM.getLoc()) {
      this.props.getEditor().highlight(VM.getLoc());
    }
    this.props.getConsole().log(e.toString());
    this.props.getConsole().flush();
  },

  getStack: function() {
    var stack = VM.getCurrentFrame().getStack();
    var src = this.props.getEditor().getValue();

    var p = stack.map(function(frameInfo) {
      var loc = frameInfo[1];
      var line = src.split('\n')[loc.start.line - 1];

      return [frameInfo[0],
              loc.start.line,
              line.slice(loc.start.column, loc.end.column)];
    });

    console.log(p);
    return p;
  },

  printReport: function() {
    this.setState({
      stack: this.getStack().map(function(frameInfo) {
        return frameInfo[0] + '(' + frameInfo[1] + '): ' + frameInfo[2];
      }).join('\n')
    });
  },

  render: function() {
    var cls = ['tool debugger', this.props.className || ''].join(' ');
    var childs = [
      dom.h1(null, 'debugger')
    ];

    if(VM.state === VM.SUSPENDED) {
      childs = childs.concat([
        dom.button({ className: 'btn btn-primary',
                     onClick: this.continue },
                   "PLAY"),
        dom.button({ className: 'btn btn-primary',
                     onClick: this.step },
                   "STEP"),
        dom.div({ className: 'stack' },
                dom.div({ className: 'inner' }, this.state.stack))
      ]);
    }
    else if(VM.state === VM.IDLE) {
      childs.push(dom.div({ className: 'disabled' },
                          "program not running"));
    }

    childs.push(dom.div({ className: 'output' }, this.props.output));
    return dom.div({ className: cls }, childs);
  }
});

var Console = React.createClass({
  getInitialState: function() {
    return { input: '',
             output: '' };
  },

  componentDidMount: function() {
    var fakeConsole = this._fakeConsole = {
      _buffer: [],

      log: function() {
        var str = Array.prototype.slice.call(arguments).join(' ');
        fakeConsole._buffer.push(str);
      },

      flush: function() {
        var cur = fakeConsole.cleared ? '' : this.state.output;
        
        if(fakeConsole._buffer.length) {
          cur = (cur ? cur + '\n' : cur) + fakeConsole._buffer.join('\n');
        }

        this.setState({
          output: cur
        });

        fakeConsole._buffer = [];
        fakeConsole.cleared = false;
      }.bind(this)
    };
  },

  componentDidUpdate: function(prevProps, prevState) {
    if(prevState.output !== this.state.output) {
      var node = $(this.getDOMNode()).find('.output');
      node.scrollTop(node.children('.inner').height());
    }
  },

  getConsoleObject: function() {
    return this._fakeConsole;
  },

  clear: function() {
    this._fakeConsole._buffer = [];
    this._fakeConsole.cleared = true;
  },

  flush: function() {
    this._fakeConsole.flush();
  },

  handleInput: function(e) {
    this.setState({ input: e.target.value });
  },

  log: function(str) {
    var cur = this.state.output;
    this.setState({
      output: cur ? (cur + '\n' + str) : str
    });
  },

  format: function(obj) {
    if(obj === undefined) {
      return 'undefined';
    }
    else if(obj === null) {
      return 'null';
    }
    else {
      var str;

      if(typeof obj === 'object') {
        str = obj.toSource ? obj.toSource() : obj.toString();
      }
      else {
        str = obj.toString();
      }

      if(str.length > 100) {
        str = str.slice(0, 100) + '...';
      }
      return str;
    }
  },

  evaluate: function(e) {
    e.preventDefault();
    try {
      this.log(this.state.input + ' == ' + 
               this.format(VM.evaluate(this.state.input)));
    }
    catch(e) {
      this.log(e.toString());
    }

    this.setState({ input: '' });
  },

  render: function() {
    var cls = ['tool console', this.props.className || ''].join(' ');
    return dom.div(
      { className: cls },
      dom.div({ className: 'output' },
              dom.div({ className: 'inner' }, this.state.output)),
      dom.div(
        { className: 'input' },
        dom.form({ onSubmit: this.evaluate },
                 dom.input({ type: 'text ',
                             value: this.state.input,
                             onChange: this.handleInput }))
      )
    );
  }
});

var Footer = React.createClass({
  render: function() {
    var cls = ['footer', this.props.className || ''].join(' ');
    return dom.div({ className: cls },
                   dom.button({ className: 'btn btn-success',
                                onClick: this.props.onRun },
                              "RUN"),
                   dom.button({ className: 'btn btn-success',
                                onClick: this.props.onToggleToolset },
                              (this.props.toolsetOpen ?
                               "CLOSE TOOLSET" :
                               "OPEN TOOLSET")));
  }
});

React.renderComponent(App(), document.body);
