    var util = require('util');

    // debugger 

    setTimeout(function() { util.print('> ') }, 1000);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    process.stdin.on('data', function(text) {
        setTimeout(function() { util.print('> ') }, 100);

        text = text.trim();
        
        switch(text) {
        case 'stack':
            console.log('*** stack:\n' + curFrame.getStack().split('\n').map(function(s) {
                return '  ' + s;
            }).join('\n'));
            break;
        case 'c':
            if(VM_STATE == VM_STATE_SUSPENDED) {
                rootFrame.run();
            }
            break;
        case 's':
            if(VM_STATE == VM_STATE_SUSPENDED) {
                curFrame.step();

                if(VM_STATE == VM_STATE_SUSPENDED) {
                    console.log('suspended: ' + curFrame.getExpression());
                }
            }
            break;
        default:
            console.log('*** invalid command');
        }
    });

    var originalSrc = require('fs').readFileSync(__debug_sourceURL, 'utf8').split('\n');
