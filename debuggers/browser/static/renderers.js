(function() {

    function GLRenderer(canvas, clothW, clothH) {
        var glOpts = {
            antialias: false,
            depth: false,
            preserveDrawingBuffer: true
        };

        this.width = canvas.width;
        this.height = canvas.height;
        this.gl = canvas.getContext('webgl', glOpts) || canvas.getContext('experimental-webgl', glOpts);
        this.persMatrix = mat4.create();
        this.worldTransform = mat4.create();
        this.finalMatrix = mat4.create();
        this.offset = [0, 0];

        if(!this.gl) {
            this.unsupported = true;
            return;
        }

        mat4.ortho(0, this.width, this.height, 0, -1, 1, this.persMatrix);
        mat4.identity(this.worldTransform);

        mat4.multiply(this.persMatrix,
                      this.worldTransform,
                      this.finalMatrix);

        this.init(
            'attribute vec3 a_position; attribute vec3 a_color; uniform float u_time;' +
                'uniform mat4 worldTransform; varying vec3 color; varying float time;' +
                'void main() { ' +
                ' color = a_color;' +
                ' time = u_time;' +
                ' gl_Position = worldTransform * vec4(a_position, 1);' +
                '}',
            'varying highp vec3 color;' +
                'varying highp float time;' +
                'void main() {' +
                ' gl_FragColor = vec4(color.y * (1.0 - time) + color.x * time,' +
                '                     color.x * (1.0 - time) + color.y * time,' +
                '                     color.z * (1.0 - time) + color.z * time,' +
                '                     1.0);' +
                '}',
            clothW,
            clothH
        );
    }

    GLRenderer.prototype.resize = function(w, h) {
        var gl = this.gl;
        this.width = w;
        this.height = h;

        mat4.ortho(0, this.width, this.height, 0, -1, 1, this.persMatrix);
        mat4.identity(this.worldTransform);

        gl.viewport(0, 0, w, h);
    };

    GLRenderer.prototype.init = function(vertexSrc, fragmentSrc, clothW, clothH) {
        var gl = this.gl;

        var vertexBuffer = gl.createBuffer();
        this.vertexBuffer = vertexBuffer;

        var colorBuffer = gl.createBuffer();
        var colors = [];
        var dimen = clothW * clothH;

        for(var i=0; i<dimen; i++) {
            for(var j=0; j<6; j++) {
                colors.push(.18 + i/dimen*.6, .18, .18);
            }
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(colors), gl.STATIC_DRAW);
        this.colorBuffer = colorBuffer;

        // program

        function compile(shader, src, type) {
            gl.shaderSource(shader, src);
            gl.compileShader(shader);

            var status = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
            if(!status) {
                var err = gl.getShaderInfoLog(shader);
                gl.deleteShader(shader);
                throw new Error(type + ' shader compilation error: ' + err);
            }

            return shader;
        }

        var vshader = compile(gl.createShader(gl.VERTEX_SHADER), vertexSrc, 'vertex');
        var fshader = compile(gl.createShader(gl.FRAGMENT_SHADER), fragmentSrc, 'fragment');

        var program = gl.createProgram();
        gl.attachShader(program, vshader);
        gl.attachShader(program, fshader);
        gl.linkProgram(program);
        gl.useProgram(program);

        var status = gl.getProgramParameter(program, gl.LINK_STATUS);
        if(!status) {
            var err = gl.getProgramInfoLog(program);
            gl.deleteProgram(program);
            throw new Error('program linking error: ' + err);
        }

        this.program = program;
        this.worldTransformLoc = gl.getUniformLocation(program, 'worldTransform');
        gl.uniformMatrix4fv(this.worldTransformLoc, false, this.finalMatrix);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
        var loc = gl.getAttribLocation(this.program, 'a_position');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer);
        loc = gl.getAttribLocation(this.program, 'a_color');
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);

        this.timeLoc = gl.getUniformLocation(this.program, 'u_time');
    };

    GLRenderer.prototype.clear = function() {
        var gl = this.gl;
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
    };

    GLRenderer.prototype.fadeIn = function() {
        if(!this.fadeStarted) {
            this.fadeStarted = Date.now();
        }
    };

    GLRenderer.prototype.setOffset = function(x, y, scale) {
        mat4.translate(this.worldTransform, [x, y, 0]);

        var m = mat4.create();
        mat4.scale(m, this.worldTransform, [scale, scale, scale]);
        this.worldTransform = m;

        this.offset = [x, y];
        this.scale = scale;
    };

    GLRenderer.prototype.render = function(entities, w, h) {
        var gl = this.gl;
        this.clear();

        mat4.multiply(this.persMatrix,
                      this.worldTransform,
                      this.finalMatrix);

        gl.uniformMatrix4fv(this.worldTransformLoc, false, this.finalMatrix);
        gl.uniform1f(this.timeLoc, 0);

        var points = [];
        for(var i=0, l=entities.length; i<l; i++) {
            var x = i % w;
            var y = Math.floor(i / w);

            if(x < w - 1 && y < h - 1) {
                var ent1 = entities[y * w + x];
                var ent2 = entities[(y + 1) * w + x];
                var ent3 = entities[(y + 1) * w + x + 1];
                var ent4 = entities[y * w + x + 1];

                points.push(ent1.pos[0]);
                points.push(ent1.pos[1]);
                points.push(ent2.pos[0]);
                points.push(ent2.pos[1]);
                points.push(ent3.pos[0]);
                points.push(ent3.pos[1]);

                points.push(ent1.pos[0]);
                points.push(ent1.pos[1]);
                points.push(ent3.pos[0]);
                points.push(ent3.pos[1]);
                points.push(ent4.pos[0]);
                points.push(ent4.pos[1]);
            }
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(points), gl.STATIC_DRAW);
        gl.drawArrays(gl.TRIANGLES, 0, points.length / 2);
    };

    window.ClothDemo = {
        GLRenderer: GLRenderer
    };
})();
