
# unwinder

An implementation of continuations in JavaScript. Includes built-in
support for breakpoints (implemented with continuations) and setting
breakpoints on running scripts.

See [this post](http://jlongster.com/Whats-in-a-Continuation) for a
deeper explanation and interactive tutorials.

This implements the paper "[Exceptional Continuations in
JavaScript](http://www.schemeworkshop.org/2007/procPaper4.pdf)". It
started as a fork of
[regenerator](https://github.com/facebook/regenerator) from January
2014, so the code is outdated. However, it is useful for demos and
exploring interesting patterns.

**Do not build actual software with this**. Not only is it an old
regenerator fork, but my work on top of it is hacky. There are no
tests, as I was figuring out what was even possible. You will likely
hit bugs when trying to write non-trivial code against this.

With that said, fixing those bugs is usually straight-forward. Each
expression needs to mark itself correcly in the state machine. Usually
this is a matter of changing 1 or 2 lines of code.

There is little ES6 support, but that could be fixed by first
transforming code with Babel.

## Getting Started

The simplest way is to write some code in a file called `program.js`
and compile it with `./bin/compile program.js`. A file called `a.out`
will be generated, or you can specify an output file as the second
argument.

```
$ ./bin/compile program.js <output-file>
$ node <output-file>
```

There is also a browser editor included in the `browser` directory.
Open `browser/index.html` to run it, and you will be able to
interactively write code and set breakpoints.

## Continuation API

Use `callCC` to capture the current continuation. It will be given to
you as a function that never returns.

```js
function foo() {
  var cont = callCC(cont => cont);
  if(typeof cont === "function") {
    cont(5);
  }
  return cont;
}

console.log(foo()); // -> 5
```

See [this post](http://jlongster.com/Exploring-Continuations-Resumable-Exceptions) for more interesting examples, including resumable exceptions.

## Machine API

At the bottom of the generated file, you will see where the program is
run by the virtual machine. This virtual machine does *not* interpret
the code; the code is real native JavaScript. All the virtual machine
does is check the behavior of the code and handle runtime information
of continuations (such as frames).

Some useful methods of the VM:

* **toggleBreakpoint(line)** - set/remove a breakpoint
* **continue()** - resume execution
* **step()** - step to the next expression
* **getTopFrame()** - if paused, get the top frame
* **abort()** - stop executing and clear out all state

Events (subscribe to events with `vm.on`):

* **paused** - fired when the code stops (breakpoint, stepped, etc)
* **error** - fired when an uncaught error occurs
* **resumed** - fired when the code resumed from being paused
* **finish** - fired when the code completes
* **cont-invoked** - fired when a continuation is invoked

## Contributing

I have turned off issues because I know there are many bugs in here
and I do not have time to triage them. However, I welcome PRs that
have a clear bugfix or purpose.

Some things I would like to see:

* Minor bugfixes and general stability improvements

* Clean up `lib/visit.js` and break up the large functions

* Remove so much manual AST construction. It would be great to give
  something a string of code and generate the AST I need
  automatically, but without having to parse the same code each time.

* Introduce two compiler modes: debugger and continuations. If we
  don't support the "debugger" mode which allows live breakpoints, we
  can do further optimizations and don't need to convert every single
  expression into the state machine. But I want this project to
  continue to support breakpoints, so it would be nice if we could
  have different compiler modes (or maybe optimization levels?)

* Tests. Oh god help me, there are no tests.

Some things I am going to reject:

* Major refactorings without any discussion beforehand. I don't have
  time to go through it.
