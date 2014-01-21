var foo, y, z;

function $__global() {
  try {
    if ($globalCtx.frame) {
      var $child = $globalCtx.frame.child;

      if ($child) {
        var $child$ctx = $child.ctx;
        $child.fn.$ctx = $child$ctx;
        $child.fn.call($child.thisPtr);

        if ($child$ctx.frame) {
          $globalCtx.frame.child = $child$ctx.frame;
          return;
        } else {
          $ctx.frame = null;
          $ctx.childFrame = null;
          $ctx[$globalCtx.resultLoc] = $child$ctx.rval;

          if (VM.stepping)
            throw null;
        }
      } else {
        if ($globalCtx.staticBreakpoint)
          $ctx.next = $ctx.next + 3;

        $ctx.frame = null;
        $ctx.childFrame = null;
      }
    } else if (VM.stepping)
      throw null;

    while (1) {
      if (VM.hasBreakpoints && VM.machineBreaks[0][$globalCtx.next] !== undefined)
        break;

      switch ($globalCtx.next) {
      case 0:
        foo = function foo() {
          var $ctx = foo.$ctx;

          if ($ctx === undefined)
            return VM.runProgram(foo, this, arguments);

          $ctx.isCompiled = true;

          try {
            if ($ctx.frame) {
              var $child = $ctx.frame.child;

              if ($child) {
                var $child$ctx = $child.ctx;
                $child.fn.$ctx = $child$ctx;
                $child.fn.call($child.thisPtr);

                if ($child$ctx.frame) {
                  $ctx.frame.child = $child$ctx.frame;
                  return;
                } else {
                  $ctx.frame = null;
                  $ctx.childFrame = null;
                  $ctx[$ctx.resultLoc] = $child$ctx.rval;

                  if (VM.stepping)
                    throw null;
                }
              } else {
                if ($ctx.staticBreakpoint)
                  $ctx.next = $ctx.next + 3;

                $ctx.frame = null;
                $ctx.childFrame = null;
              }
            } else if (VM.stepping)
              throw null;

            while (1) {
              if (VM.hasBreakpoints && VM.machineBreaks[1][$ctx.next] !== undefined)
                break;

              switch ($ctx.next) {
              case 0:
                $ctx.rval = 2 + 2;
                delete $ctx.thrown;
                $ctx.next = 4;
                break;
              default:
              case 4:
                foo.$ctx = undefined;
                return $ctx.stop();
              case -1:
                $ctx.rval = eval(VM.evalArg);
              }

              if (VM.stepping)
                break;
            }
          }catch (e) {
            VM.error = e;
          }

          $ctx.frame = new $Frame(1, "foo", foo, {}, ["foo", "y", "z"], this, $ctx, $ctx.childFrame);
          foo.$ctx = undefined;
        };

        $globalCtx.next = 3;
        break;
      case 3:
        y = 5 + 5;
        $globalCtx.next = 6;
        break;
      case 6:
        var $t1 = VM.getContext();
        $t1.softReset();
        foo.$ctx = $t1;
        var $t2 = foo();
        $globalCtx.next = 15;

        if ($t1.frame) {
          $globalCtx.childFrame = $t1.frame;
          $globalCtx.resultLoc = "t0";
          VM.stepping = true;
          break;
        }

        $globalCtx.t0 = ($t1.isCompiled ? $t1.rval : $t2);
        VM.releaseContext();
        break;
      case 15:
        z = $globalCtx.t0;
        $globalCtx.next = 18;
        break;
      case 18:
        var $t4 = VM.getContext();
        $t4.softReset();
        console.log.$ctx = $t4;
        var $t5 = console.log(z);
        $globalCtx.next = 27;

        if ($t4.frame) {
          $globalCtx.childFrame = $t4.frame;
          $globalCtx.resultLoc = "t3";
          VM.stepping = true;
          break;
        }

        $globalCtx.t3 = ($t4.isCompiled ? $t4.rval : $t5);
        VM.releaseContext();
        break;
      default:
      case 27:
        $__global.$ctx = undefined;
        return $globalCtx.stop();
      case -1:
        $globalCtx.rval = eval(VM.evalArg);
      }

      if (VM.stepping)
        break;
    }
  }catch (e) {
    throw e;
    VM.error = e;
  }

  $globalCtx.frame = new $Frame(0, "$__global", $__global, {
    "foo": foo,
    "y": y,
    "z": z
  }, [], this, $globalCtx, $globalCtx.childFrame);

  $__global.$ctx = undefined;
}

return $__global;
