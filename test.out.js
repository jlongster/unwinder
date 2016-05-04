
__debug_sourceURL="test.js";
var fs, foo, bar, point, foo2;

function $__global() {
  var $__next = 0;
  var $__tmpid = 0;
  var $__t1;
  var $__t2;

  try {
    if (VM.doRestore) {
      var $__frame = VM.popFrame();
      $__next = $__frame.next;
      var $__child = VM.nextFrame();

      if ($__child) {
        $__frame.state["$__t" + $__frame.tmpid] = $__child.fn.call($__child.thisPtr);

        if (VM.stepping)
          throw new $ContinuationExc(null, $__frame);
      }

      $__t1 = $__frame.state.$__t1;
      $__t2 = $__frame.state.$__t2;
    } else if (VM.stepping)
      throw new $ContinuationExc();

    while (1) {
      if (VM.hasBreakpoints && VM.machineBreaks[1][$__next] !== undefined)
        throw new $ContinuationExc();

      switch ($__next) {
      case 0:
        foo2 = function $foo2() {
          var baz;

          if (!VM.running)
            return VM.execute($foo2, null, this, arguments);

          var $__next = 0;
          var $__tmpid = 0;
          var $__t1;

          try {
            if (VM.doRestore) {
              var $__frame = VM.popFrame();
              baz = $__frame.state.baz;
              $__next = $__frame.next;
              var $__child = VM.nextFrame();

              if ($__child) {
                $__frame.state["$__t" + $__frame.tmpid] = $__child.fn.call($__child.thisPtr);

                if (VM.stepping)
                  throw new $ContinuationExc(null, $__frame);
              }

              $__t1 = $__frame.state.$__t1;
            } else if (VM.stepping)
              throw new $ContinuationExc();

            while (1) {
              if (VM.hasBreakpoints && VM.machineBreaks[0][$__next] !== undefined)
                throw new $ContinuationExc();

              switch ($__next) {
              case 0:
                baz = 5;
                $__next = 3;
                break;
              case 3:
                baz + 1;
                $__next = 6;
                break;
              case 6:
                baz + 2;
                $__next = 9;
                break;
              case 9:
                $__next = 11;
                throw new $ContinuationExc();
              case 11:
                $__next = 13;
                $__t1 = baz;
              case 13:
                return $__t1;
              default:
              case 14:
                return;
              case -1:
                VM.evalResult = eval(VM.evalArg);
                throw new $ContinuationExc();
              }

              if (VM.stepping)
                throw new $ContinuationExc();

              if (VM.hasWatches && VM.machineWatches[0][$__next] !== undefined)
                VM.handleWatch(0, $__next, eval(VM.machineWatches[0][$__next].src));
            }
          }catch (e) {
            if (!(e instanceof $ContinuationExc))
              e = new $ContinuationExc(e);

            if (!e.reuse) e.pushFrame(new $Frame(0, "foo2", $foo2, $__next, {
              baz: baz,
              $__t1: $__t1
            }, [{
              "name": "baz",
              "boxed": false
            }, {
              "name": "fs",
              "boxed": false
            }, {
              "name": "foo",
              "boxed": false
            }, {
              "name": "bar",
              "boxed": false
            }, {
              "name": "point",
              "boxed": false
            }, {
              "name": "foo2",
              "boxed": false
            }], this, null, $__tmpid));

            e.reuse = false;
            throw e;
          }
        };

        $__next = 3;
        break;
      case 3:
        $__next = 7;
        $__tmpid = 1;
        $__t1 = require('fs');
        break;
      case 7:
        fs = $__t1;
        $__next = 10;
        break;
      case 10:
        foo = 5;
        $__next = 13;
        break;
      case 13:
        bar = 6;
        $__next = 16;
        break;
      case 16:
        $__t1 = foo * 2;
        $__next = 19;
        break;
      case 19:
        $__t2 = bar * 2;
        $__next = 22;
        break;
      case 22:
        point = {
          x: $__t1,
          y: $__t2
        };

        $__next = 25;
        break;
      case 25:
        $__next = 29;
        $__tmpid = 2;
        $__t2 = foo2();
        break;
      case 29:
        $__t1 = $__t2;
        $__next = 32;
        break;
      case 32:
        $__next = 36;
        $__tmpid = 2;
        $__t2 = console.log($__t1);
        break;
      default:
      case 36:
        return;
      case -1:
        VM.evalResult = eval(VM.evalArg);
        throw new $ContinuationExc();
      }

      if (VM.stepping)
        throw new $ContinuationExc();

      if (VM.hasWatches && VM.machineWatches[1][$__next] !== undefined)
        VM.handleWatch(1, $__next, eval(VM.machineWatches[1][$__next].src));
    }
  }catch (e) {
    if (!(e instanceof $ContinuationExc))
      e = new $ContinuationExc(e);

    if (!e.reuse) e.pushFrame(new $Frame(1, "__global", $__global, $__next, {
      fs: fs,
      foo: foo,
      bar: bar,
      point: point,
      foo2: foo2,
      $__t1: $__t1,
      $__t2: $__t2
    }, [{
      "name": "fs",
      "boxed": false
    }, {
      "name": "foo",
      "boxed": false
    }, {
      "name": "bar",
      "boxed": false
    }, {
      "name": "point",
      "boxed": false
    }, {
      "name": "foo2",
      "boxed": false
    }], this, null, $__tmpid));

    e.reuse = false;
    throw e;
  }
}

