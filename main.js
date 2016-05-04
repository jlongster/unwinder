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
    supportBlockBinding: true
  });

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
