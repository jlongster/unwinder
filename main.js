/**
 * Copyright (c) 2013, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * https://raw.github.com/facebook/regenerator/master/LICENSE file. An
 * additional grant of patent rights can be found in the PATENTS file in
 * the same directory.
 */

var assert = require("assert");
var path = require("path");
var fs = require("fs");
var types = require("ast-types");
var b = types.builders;
var transform = require("./lib/visit").transform;
var utils = require("./lib/util");
var recast = require("recast");
var esprimaHarmony = require("esprima");
var genFunExp = /\bfunction\s*\*/;
var blockBindingExp = /\b(let|const)\s+/;

assert.ok(
  /harmony/.test(esprimaHarmony.version),
  "Bad esprima version: " + esprimaHarmony.version
);

function regenerator(source, options) {
  options = utils.defaults(options || {}, {
    includeRuntime: false,
    supportBlockBinding: true
  });

  var runtime = options.includeRuntime ? fs.readFileSync(
    regenerator.runtime.dev, "utf-8"
  ) + "\n" : "";

  var runtimeBody = recast.parse(runtime, {
    sourceFileName: regenerator.runtime.dev
  }).program.body;

  var supportBlockBinding = !!options.supportBlockBinding;
  if (supportBlockBinding) {
    if (!blockBindingExp.test(source)) {
      supportBlockBinding = false;
    }
  }

  var recastOptions = {
    tabWidth: utils.guessTabWidth(source),
    // Use the harmony branch of Esprima that installs with regenerator
    // instead of the master branch that recast provides.
    esprima: esprimaHarmony,
    range: supportBlockBinding,
      loc: true
  };

  var recastAst = recast.parse(source, recastOptions);
  var ast = recastAst.program;

  // Transpile let/const into var declarations.
  if (supportBlockBinding) {
    var defsResult = require("defs")(ast, {
      ast: true,
      disallowUnknownReferences: false,
      disallowDuplicated: false,
      disallowVars: false,
      loopClosures: "iife"
    });

    if (defsResult.errors) {
      throw new Error(defsResult.errors.join("\n"))
    }
  }

  var transformed = transform(ast, options);
  recastAst.program = transformed.ast;
  var appendix = '';

  // Include the runtime by modifying the AST rather than by concatenating
  // strings. This technique will allow for more accurate source mapping.
  if (options.includeRuntime) {
    recastAst.program.body = [b.variableDeclaration(
      'var',
      [b.variableDeclarator(
        b.identifier('$__global'),
        b.callExpression(
          b.functionExpression(
            null, [],
            b.blockStatement(recastAst.program.body)
          ),
          []
        )
      )]
    )];

    var body = recastAst.program.body;
    body.unshift.apply(body, runtimeBody);

    appendix += 'var VM = new $Machine();\n' +
      'VM.on("error", function(e) { throw e; });\n' +
      'VM.run($__global, __debugInfo);';
  }

  if(options.includeDebug) {
    var body = recastAst.program.body;
    body.unshift.apply(body, transformed.debugAST);
  }

  return {
    code: recast.print(recastAst, recastOptions).code + '\n' + appendix,
    debugInfo: transformed.debugInfo
  };
}

// To modify an AST directly, call require("regenerator").transform(ast).
regenerator.transform = transform;

regenerator.runtime = {
  dev: path.join(__dirname, "runtime", "vm.js"),
  min: path.join(__dirname, "runtime", "min.js")
};

// To transform a string of ES6 code, call require("regenerator")(source);
module.exports = regenerator;
