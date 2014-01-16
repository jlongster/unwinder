
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

    this.breakpoints = [];
  },

  handleSourceChange: function(src) {
    VM.reset();
    this.refs.editor.highlight(null);
    this.setState({ source: src });
  },

  handleBreakpoint: function(line) {
    var breakpoints = this.breakpoints;
    var i = breakpoints.indexOf(line);
    if(i === -1) {
      breakpoints.push(line);
    }
    else {
      breakpoints.splice(i, 1);
    }

    if(VM.state !== VM.IDLE) {
      return VM.toggleBreakpoint(VM.lineToInternalLoc(line));
    }
    return true;
  },

  run: function() {
    if(VM.state === VM.SUSPENDED) {
      VM.run();
      return;
    }
    
    VM.reset();

    var consoleTool = this.refs.toolset.getTool('console');
    consoleTool.clear();

    try {
      var output = probejs.compile(this.refs.editor.getValue());
    }
    catch(e) {
      consoleTool.log(e.toString());
      return;
    }

    this.setState({
        displayValue: output.code
    });

    VM.setDebugInfo(output.debugInfo);

    this.breakpoints.forEach(function(line, i) {
      var loc = VM.lineToInternalLoc(line);
      if(!loc) {
        loc = VM.lineToInternalLoc(line + 1);
        if(loc) {
          this.breakpoints[i] = line + 1;
        }
      }

      VM.toggleBreakpoint(loc);
    }.bind(this));

    // var display = this.refs.display.getDOMNode();
    // var canvas = display.querySelector('canvas');
    var canvas = null;

    var func = new Function(
      'VM', 'console', 'canvas',
      output.code
    );

    func(VM, consoleTool.getConsoleObject(), canvas);
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
          onChange: this.handleSourceChange,
          onToggleBreakpoint: this.handleBreakpoint
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
      this.props.onToggleBreakpoint(info.line + 1);
    }.bind(this));

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
      // // HACK: take 20px off to account for padding
      // var h = rect.height - 20;
      mirror.setSize(null, rect.height);
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
      this.highlight(VM.getLocation());
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
                getDebugger: this.getTool.bind(this, 'debugger'),
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
      this.props.getEditor().highlight(VM.getLocation());
      this.printReport();
    }.bind(this);

    VM.onFinish = function() {
      this.props.getEditor().highlight(null);
      this.printReport();
      this.props.getConsole().flush();      
    }.bind(this);

    VM.onError = function(e) {
      this.handleError(e);      
    }.bind(this);
  },

  continue: function() {
    VM.run();
    this.props.getConsole().flush();
  },

  step: function() {
    VM.step();
    this.props.getConsole().flush();
  },

  handleError: function(e) {
    console.log(e.stack);

    if(VM.getLocation()) {
      this.props.getEditor().highlight(VM.getLocation());
    }

    //console.log(e.toString());
    this.props.getConsole().log(e.toString(), true);
    this.printReport();
  },

  printReport: function() {
    if(VM.state !== VM.IDLE) {
      var frame = VM.getRootFrame();
      var top = VM.getTopFrame();
      var src = this.props.getEditor().getValue();
      var scope = _.uniq(_.keys(top.scope).concat(top.outerScope)).map(function(name) {
        var value = top.evaluate(name).result;
        return [name, this.props.getConsole().format(value)];
      }.bind(this));

      this.setState({
        stack: frame.stackReduce(function(acc, frame) {
          if(frame.name != 'top-level') {
            return (acc ? acc + '\n' : acc) +
              frame.name + ': ' + frame.getExpression(src);
          }
          return acc;
        }, ''),
        scope: scope
      });
    }
    else {
      this.setState({ stack: 'finished!' });
    }
  },

  render: function() {
    var cls = ['tool debugger', this.props.className || ''].join(' ');
    var childs = [];
    var state = this.state;

    if(VM.state === VM.SUSPENDED) {
      childs = childs.concat([
        dom.button({ className: 'btn btn-primary',
                     onClick: this.continue },
                   "PLAY"),
        dom.button({ className: 'btn btn-primary',
                     onClick: this.step },
                   "STEP"),
        dom.div(
          null,
          dom.div({ className: 'col-sm-6 stack' },
                  dom.div({ className: 'inner' }, state.stack)),
          dom.div({ className: 'col-sm-6 scope' },
                  dom.div({ className: 'inner' },
                          state.scope.map(function(v) {
                            return dom.div(null, v[0] + ': ' + v[1]);
                          })))
        )
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

  log: function(str, buffered) {
    if(buffered) {
      this._fakeConsole.log(str);
    }
    else {
      var cur = this.state.output;
      this.setState({
        output: cur ? (cur + '\n' + str) : str
      });
    }
  },

  format: function(obj) {
    if(obj === undefined) {
      return 'undefined';
    }
    else if(obj === null) {
      return 'null';
    }
    else if(_.isFunction(obj)) {
      return '<func>';
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
    this.props.getDebugger().printReport();
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
