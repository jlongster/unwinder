
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
    return {
      source: null,
      toolsetOpen: true,
      client: null
    };
  },

  componentDidMount: function() {
    var filename = (window.location.hash || '#src.txt').slice(1);
    $.get(filename, function(res) {
      this.setState({ source: res });
    }.bind(this));

    this._onResize = function() {
      this.refs.editor.resize();
      this.refs.display.resize();
    }.bind(this);

    $(window).on('resize', this._onResize);
  },

  componentDidUpdate: function(prevProps, prevState) {
    if(prevState.client !== this.state.client) {
      this.state.client.on('breakpoint', function(loc) {
        this.openToolset('debugger');
        this.refs.editor.highlight(loc);
        this.refs.toolset.getTool('debugger').printReport();
      }.bind(this));
    }
  },

  componentWillUnmount: function() {
    $(window).off('resize', this._onResize);
  },

  handleSourceChange: function(src) {
    this.refs.editor.highlight(null);
    this.setState({ source: src });
  },

  handleBreakpoint: function(line) {
    if(this.state.client) {
      this.state.debugInfo.toggleBreakpoint(line);
      this.state.client.send({ type: 'setDebugInfo',
                               args: [this.state.debugInfo] });
    }
  },

  compile: function(src, opts) {
    try {
      return probejs.compile(src, opts);
    }
    catch(e) {
      console.log(e.toString() + '\n' + e.stack);
      return;
    }
  },

  runExpression: function() {
    var editor = this.refs.editor;
    var cursor = editor._editor.getCursor();
    cursor.line += 1;

    function getNodeAtPoint(nodes, cursor) {
      return nodes.reduce(function(acc, topNode) {
        var loc = topNode.loc;

        if((loc.start.line < cursor.line &&
            loc.end.line > cursor.line) ||
           (loc.start.line === cursor.line &&
            loc.start.column <= cursor.ch) ||
           (loc.end.line === cursor.column &&
            loc.end.column >= cursor.ch)) {
          return topNode;
        }
        return acc;
      }, null);
    }

    function findDeepestFunction(node, cursor) {
      var found = getNodeAtPoint(node.body.body, cursor);

      if(!found) {
        return null;
      }
      else if(found.type !== 'FunctionDeclaration' &&
              found.type !== 'FunctionExpression') {
        return null;
      }
      else {
        return findDeepestFunction(found, cursor) || found;
      }
    }

    var ast = esprima.parse(editor.getValue(), {
      loc: true,
      range: true
    });

    var node = getNodeAtPoint(ast.body, cursor);
    if(node.type === 'FunctionExpression' ||
       node.type === 'FunctionDeclaration') {
      node = findDeepestFunction(node, cursor) || node;
    }

    var src = editor.getValue().slice(node.range[0], node.range[1]);
    this.state.client.send({ type: 'eval',
                             args: [src] }, function(err, res) {
                               console.log(err, res);
                             });
    //this.setState({ debugInfo: debugInfo });
  },

  run: function() {
    var state = this.state;
    var client = state.client;
    var editor = this.refs.editor;
    var consoleTool = this.refs.toolset.getTool('console');
    var src = editor.getValue();
    consoleTool.clear();

    var output = this.compile(src);

    // external scripts
    var resources = this.refs.toolset.getTool('resources');
    var scripts = resources.state.urls.map(function(url) {
      return '<script src="' + url + '"></script>';
    }).join('');

    var debugInfo = new $DebugInfo(output.debugInfo);
    var display = this.refs.display.getDOMNode();
    var iframe = display.querySelector('iframe');
    iframe.srcdoc = '<!DOCTYPE html>' +
      '<html>' +
      '<head><style>' +
      'html, body { margin: 0; width: 100%; height: 100%; }' +
      '</style></head>' +
      '<body>' +
      '<canvas></canvas>' +
      '<script src="/lib/lodash.min.js"></script>' + // temporary
      '<script src="/probe.js"></script>' +
      '<script src="/vm.js"></script>' +
      '<script>var VM = new $Machine();</script>' +
      '<script src="/conn.js"></script>' +
      '<script src="/app-conn.js"></script>' +
      scripts +
      // '<script src="/src.js"></script>' +
      '</body></html>';

    if(client) {
      client.kill();
    }
    client = new Connection(iframe.contentWindow, 'parent');
    client.on('ready', function() {
      // hack to scan for breakpoints
      var mirror = editor._editor;
      mirror.eachLine(function(line) {
        var info = mirror.lineInfo(line);
        var markers = info.gutterMarkers;
        if(markers) {
          debugInfo.toggleBreakpoint(info.line + 1);
        }
      });

      client.send({ type: 'run',
                    args: [output.code, debugInfo] });
    });

    this.setState({ client: client,
                    debugInfo: debugInfo });
  },

  toggleToolset: function(tool) {
    this.setState({ toolsetOpen: !this.state.toolsetOpen });
  },

  openToolset: function() {
    this.setState({ toolsetOpen: true });
    //this.refs.toolset.tool('debugger');
  },

  closeToolset: function() {
    this.setState({ toolsetOpen: false });
  },

  getMachine: function() {
    return this.state.machine;
  },

  toggleCode: function() {
    this.setState({ codeOpen: !this.state.codeOpen });
  },

  render: function() {
    return dom.div(
      { className: 'app' },
      dom.div(
        { className: 'app-inner' },
        dom.div(
          { className: 'editor-wrapper' },
          Editor({
            ref: 'editor',
            value: this.state.source,
            client: this.state.client,
            onChange: this.handleSourceChange,
            onToggleBreakpoint: this.handleBreakpoint
          }),
          Footer({ onRun: this.run,
                   onCompile: this.compile,
                   onRunExpression: this.runExpression,
                   toolsetOpen: this.state.toolsetOpen,
                   onToggleToolset: this.toggleToolset,
                   onCode: this.toggleCode })
        ),
        Display({ ref: 'display',
                  className: (this.state.toolsetOpen ? 'partial' : 'full'),
                  value: this.state.displayValue }),
        Toolset({ className: this.state.toolsetOpen ? '' : 'hidden',
                  ref: 'toolset',
                  toolsetOpen: this.state.toolsetOpen,
                  client: this.state.client,
                  onClose: this.closeToolset,
                  getEditor: function() {
                    return this.refs.editor;
                  }.bind(this) })
      )
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
      autofocus: true,
      smartIndent: false,
      indentWithTabs: false,
      indentUnit: 2
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
      // marker.style.color = "#822";
      marker.innerHTML = "●";
      marker.className = 'marker';
      return marker;
    }

    this._editor = mirror;
    this.resize();
  },

  resize: function() {
    var rect = this.getDOMNode().getBoundingClientRect();
    this._editor.setSize(null, rect.height);
  },

  getValue: function() {
    return this._editor.getValue();
  },

  componentDidUpdate: function(prevProps) {
    if(this.props.value !== this._editor.getValue()) {
      this._editor.setValue(this.props.value || '');
    }

    if(prevProps.client !== this.props.client) {
      this.props.client.on('change', function(state, loc) {
        if(state == 'suspended') {
          this.highlight(loc);
        }
      });
    }

    this.resize();
  },

  highlight: function(loc) {
    var editor = this._editor;

    if(this._lastMarker) {
      this._lastMarker.clear();
      this._lastMarker = null;
    }

    if(this._lastLine) {
      editor.removeLineClass(this._lastLine, 'background');
      this._lastLine = null;
    }

    if(loc) {
      this._lastMarker = editor.markText(
        { line: loc.start.line - 1,
          ch: loc.start.column },
        { line: loc.end.line - 1,
          ch: loc.end.column },
        { className: 'highlight-text' }
      );

      this._lastLine = loc.start.line - 1;
      editor.addLineClass(loc.start.line - 1, 'background', 'highlight');

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
  componentDidMount: function() {
    this.resize();
  },

  componentDidUpdate: function() {
    this.resize();
  },

  resize: function() {
    var root = this.getDOMNode();
    var iframe = $(root).find('iframe')[0];
    var rect = root.getBoundingClientRect();
    iframe.width = rect.width;
    iframe.height = rect.height;
  },

  render: function() {
    var cls = ['display', this.props.className || ''].join(' ');
    return dom.div(
      { className: cls },
      dom.div({ className: 'inner' },
              dom.iframe())
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
      return this.props.toolsetOpen ? cls : null;
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
                     "CONSOLE")),
        dom.li({ className: activeClass('resources', 'active') },
               dom.a({ onClick: this.tool.bind(this, 'resources') },
                     "RESOURCES"))
      ),
      Debugger({ ref: 'debugger',
                 className: activeClass('debugger', 'show'),
                 onClose: this.closeTool,
                 client: this.props.client,
                 getConsole: this.getTool.bind(this, 'console'),
                 getEditor: this.props.getEditor }),
      Console({ ref: 'console',
                className: activeClass('console', 'show'),
                client: this.props.client,
                getDebugger: this.getTool.bind(this, 'debugger'),
                onClose: this.closeTool }),
      Resources({ ref: 'resources',
                  className: activeClass('resources', 'show') })
    );
  }
});

var Debugger = React.createClass({
  getInitialState: function() {
    return { output: '',
             stack: [],
             scope: [],
             runstate: 'idle' };
  },

  componentDidUpdate: function(prevProps) {
    if(prevProps.client !== this.props.client) {
      var client = this.props.client;

      client.on('error', function(err, stack, loc) {
        this.handleError(err, stack, loc);
      }.bind(this));

      client.on('finish', function() {
        this.props.getEditor().highlight(null);
        //this.printReport();
      }.bind(this));
    }
  },

  continue: function() {
    this.props.client.send({ type: 'continue' });
    this.props.getEditor().highlight(null);
  },

  step: function() {
    this.props.client.send({ type: 'step' });
  },

  stepOver: function() {
    this.props.client.send({ type: 'stepOver' });
  },

  handleError: function(err, stack, loc) {
    if(loc) {
      this.props.getEditor().highlight(loc);
    }

    this.props.getConsole().log(err.toString() + '\n' + stack);
    this.printReport();
  },

  printReport: function() {
    var client = this.props.client;

    client.send({
      type: 'query',
      args: ['state,stack,scope']
    }, function(state, stack, scope) {
      if(state !== 'idle') {
        var srclines = this.props.getEditor().getValue().split('\n');
        scope = _.unique(scope);

        this.props.client.send({
          type: 'eval',
          args: ['[' + scope.join(',') + ']']
        }, function(err, res) {
          this.setState({
            scope: _.zip(scope, res)
          });
        }.bind(this));

        this.setState({
          stack: stack.reduce(function(acc, frame) {
            if(frame.name != '__global') {
              var line = srclines[frame.loc.start.line - 1];
              acc.push(frame.name + ': ' +
                       line.slice(frame.loc.start.column,
                                  frame.loc.end.column));
              return acc;
            }
            return acc;
          }, []),
          runstate: state
        });
      }
      else {
        this.setState(this.getInitialState());
      }
    }.bind(this));
  },

  render: function() {
    var cls = ['tool debugger', this.props.className || ''].join(' ');
    var childs = [];
    var state = this.state;

    if(this.state.runstate == 'suspended') {
      childs = childs.concat([
        dom.div(
          { className: 'buttons' },
          dom.div({ className: 'state' }, 'paused'),
          dom.button({ className: 'btn btn-primary',
                       onClick: this.continue },
                     "PLAY"),
          dom.button({ className: 'btn btn-primary',
                       onClick: this.step },
                     "STEP"),
          dom.button({ className: 'btn btn-primary',
                       onClick: this.stepOver },
                     "STEP OVER")
        ),
        dom.div(
          { className: 'col-sm-6 stack-outer' },
          dom.div(null, 'yo stack'),
          dom.div({ className: 'stack' },
                  dom.div({ className: 'inner' },
                          state.stack.map(function(v) {
                            return dom.div(null, v);
                          })))),
        dom.div(
          { className: 'col-sm-6 scope-outer' },
          dom.div(null, 'yo scope'),
          dom.div({ className: 'scope' },
                  dom.div({ className: 'inner' },
                          state.scope.map(function(v) {
                            return dom.div(null, v[0] + ': ' + v[1]);
                          }))))
      ]);
    }
    else {
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

  componentDidUpdate: function(prevProps, prevState) {
    if(prevState.output !== this.state.output) {
      var node = $(this.getDOMNode()).find('.output');
      node.scrollTop(node.children('.inner').height());
    }

    if(prevProps.client !== this.props.client) {
      this.props.client.on('log', function(msg) {
        this.log(msg);
      }.bind(this));
    }
  },

  getConsoleObject: function() {
    return this._fakeConsole;
  },

  clear: function() {
    this.setState({ output: '' });
  },

  handleInput: function(e) {
    this.setState({ input: e.target.value });
  },

  log: function(str, buffered) {
    var cur = this.state.output;
    this.setState({
      output: cur ? (cur + '\n' + str) : str
    });
  },

  evaluate: function(e) {
    e.preventDefault();
    var client = this.props.client;

    client.send({
      type: 'eval',
      args: [this.state.input]
    }, function(err, res) {
      this.log(this.state.input + '\n' + res);
      this.setState({ input: '' });
      this.props.getDebugger().printReport();
    }.bind(this));
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

var Resources = React.createClass({
  getInitialState: function() {
    return {
      urls: [
        'http://jlongster.com/s/cloth/gl-matrix.js',
        'http://jlongster.com/s/cloth/renderers.js',
        'mouse.js'
      ]
    };
  },

  handleInput: function(e) {
    this.setState({ inputUrl: e.target.value });
  },

  add: function(e) {
    e.preventDefault();
    this.setState({
      urls: this.state.urls.concat([this.state.inputUrl]),
      inputUrl: ''
    });
  },

  remove: function(e, i) {
    e.preventDefault();
    var urls = this.state.urls.slice();
    urls.splice(i, 1);

    this.setState({
      urls: urls,
      inputUrl: ''
    });
  },

  render: function() {
    var cls = ['tool resources', this.props.className || ''].join(' ');
    return dom.div(
      { className: cls },
      dom.ul(
        null,
        this.state.urls.map(function(url, i) {
          return dom.li(
            null,
            dom.div(
              null,
              url,
              dom.a({ href: '#',
                      onClick: function(e) {
                        this.remove(e, i);
                      }.bind(this) },
                    'x')
            )
          );
        }.bind(this))
      ),
      dom.form(
        { onSubmit: this.add },
        dom.input({ onChange: this.handleInput,
                    value: this.state.inputUrl })
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
                                onClick: this.props.onRunExpression },
                              "RUN EXPRESSION"),
                   dom.button({ className: 'btn btn-success',
                                onClick: this.props.onToggleToolset },
                              (this.props.toolsetOpen ?
                               "CLOSE TOOLSET" :
                               "OPEN TOOLSET")));
  }
});

React.renderComponent(App(), document.body);
