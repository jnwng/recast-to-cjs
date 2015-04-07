var recast = require('recast');
var n = recast.types.namedTypes;

var assert = require('assert');
var generators = require('../generators');
var generateRequire = generators.require;
var generateExports = generators.exports;
var b = recast.types.builders;
var findIdentifier = require('../visitors/findIdentifier');

module.exports = function(code) {
  var ast = recast.parse(code);
  recast.visit(ast, module.exports.__visitors);
  return recast.print(ast).code;
};

// keep this private and not mutatable
Object.defineProperty(module.exports, '__visitors', {
  enumerable: false,
  configurable: false,
  value: Object.freeze({
    visitCallExpression: function(path) {
      if (this.isAMDDefinition(path)) {
        return this.visitAMDModule(path);
      }

      this.traverse(path);
    },

    visitReturnStatement: function(path) {
      if (this.shouldBeModuleExports(path)) {
        return generateExports(path.value.argument);
      }

      this.traverse(path);
    },

    visitAMDModule: function(path) {
      var node = path.node;
      var dependencies = this.transformedDependencies(path);
      var moduleBody = this.transformedModuleBody(path);
      if (moduleBody) {
        var p = path.parent;
        var statements = [];

        if (dependencies && dependencies.length) {
          statements.push.apply(statements, dependencies);
        }

        // define({obj: prop}); signature
        if (n.AssignmentExpression.check(moduleBody)) {
          moduleBody = b.expressionStatement(moduleBody);
        }

        if (moduleBody.body && moduleBody.body.length) {
          statements.push.apply(statements, moduleBody.body);
        } else {
          statements.push(moduleBody);
        }

        statements.reverse().forEach(function(statement) {
          p.insertAfter(statement);
        });
        p.replace();
      }

      // replace the AMD CallExpression itself
      this.traverse(path);
    },

    isAMDDefinition: function(path) {
      var node = path.node;
      return !isCjs() && (isCallExpressionNamed('require') || isCallExpressionNamed('define'));

      function isCjs() {
        return (isCallExpressionNamed('require') &&
          n.Literal.check(node.arguments[0]))
      }

      function isCallExpressionNamed(name) {
        return (n.CallExpression.check(node) &&
                name === node.callee.name);
      }
    },

    /**
     * @return [Array{CJSExpressions}|undefined]
     */
    transformedDependencies: function(path) {
      var node = path.node;
      var dependencies = this.extractAMDDependencies(path) || [];

      return dependencies.map(function(a) {
        return generateRequire(a[0], a[1]);
      });
    },

    transformedModuleBody: function(path) {
      var node = path.node;
      var body = this.extractModuleBody(path);

      if (body) {
        if (n.ObjectExpression.check(body)) {
          return generateExports(body);
        }
        else if (n.FunctionExpression.check(body)) {
          this.traverse(path);
          return body.body;
        }
      }

      return path;
    },

    hasAncestor: function(path, descriptor, maxDepth) {
      if (typeof descriptor.validator !== 'function') {
        assert.ok(descriptor.type);
        assert.ok(!!n[descriptor.type]);
      }

      function lookup(path, currentDepth) {
        if (currentDepth > maxDepth || typeof path === 'undefined') {
          return false;
        }

        if (descriptor.validator(path.parent)) {
          return true;
        }

        return lookup(path.parent, currentDepth + 1);
      }

      return lookup(path.parent, 0);
    },

    shouldBeModuleExports: function(path) {
      var self = this;
      return this.hasAncestor(path, {
        validator: this.isAMDDefinition
      }, 3);
    },

    /**
     * @param {NodePath} path AMD Call Expression
     * @return {Array} {value: Identifier|String, module: String}
     */
    extractAMDDependencies: function(path) {
      assert.ok(this.isAMDDefinition(path));

      var node = path.node;
      // TODO: http://requirejs.org/docs/whyamd.html#namedmodules
      if (node.arguments.length < 2) return null;

      var dependencies = node.arguments[0];
      var factory = last(node.arguments);

      var args = node.arguments;

      if (n.ArrayExpression.check(dependencies)) {
        dependencies = dependencies.elements;
      }
      else {
        // resolve variable key
        //   var REQUIREMENTS = ["dep1", "dep2"];
        //   require(REQUIREMENTS, (dep1, dep2) => {});
        dependencies = findIdentifier(dependencies.name, this.getRoot(path)).elements;
      }

      return zip(dependencies, factory.params);
    },

    /**
     * @param {NodePath} path AMD Call Expression
     * @return {Array} {value: Identifier|String, module: String}
     */
    extractModuleBody: function(path) {
      assert.ok(this.isAMDDefinition(path));
      var node = path.node;
      return last(node.arguments);
    },

    getRoot: function(path) {
      var c = path;
      while (typeof c.parent !== 'undefined' && c.parent !== null) {
        c = c.parent;
      }
      return c;
    },
  }),
});

function last(a) {
  return a[a.length - 1];
}

function zip(a, b) {
  return a.map(function(a, i) {
    return [a, b[i]];
  });
}
