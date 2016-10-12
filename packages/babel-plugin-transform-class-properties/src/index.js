/* eslint max-len: 0 */
// todo: define instead of assign
import nameFunction from "babel-helper-function-name";

export default function ({ types: t }) {
  let findBareSupers = {
    Super(path) {
      if (path.parentPath.isCallExpression({ callee: path.node })) {
        this.push(path.parentPath);
      }
    }
  };

  let referenceVisitor = {
    ReferencedIdentifier(path) {
      if (this.scope.hasOwnBinding(path.node.name)) {
        this.collision = true;
        path.skip();
      }
    }
  };

  return {
    inherits: require("babel-plugin-syntax-class-properties"),

    visitor: {
      Class(path) {
        let isDerived = !!path.node.superClass;
        let constructor;
        let props = [];
        let body = path.get("body");

        for (let path of body.get("body")) {
          if (path.isClassProperty()) {
            props.push(path);
          } else if (path.isClassMethod({ kind: "constructor" })) {
            constructor = path;
          }
        }

        if (!props.length) return;

        let nodes = [];
        let ref;

        if (path.isClassExpression() || !path.node.id) {
          nameFunction(path);
          ref = path.scope.generateUidIdentifier("class");
        } else { // path.isClassDeclaration() && path.node.id
          ref = path.node.id;
        }

        let instanceBody = [];

        for (let prop of props) {
          let propNode = prop.node;
          if (propNode.decorators && propNode.decorators.length > 0) continue;
          if (!propNode.value) continue;

          let isStatic = propNode.static;
          let isComputed = propNode.computed || t.isLiteral(prop.key);

          if (isStatic) {
            nodes.push(t.expressionStatement(
              t.assignmentExpression("=", t.memberExpression(ref, propNode.key, isComputed), propNode.value)
            ));
          } else {
            instanceBody.push(t.expressionStatement(
              t.assignmentExpression("=", t.memberExpression(t.thisExpression(), propNode.key, isComputed), propNode.value)
            ));
          }
        }

        if (instanceBody.length) {
          if (!constructor) {
            let newConstructor = t.classMethod("constructor", t.identifier("constructor"), [], t.blockStatement([]));
            if (isDerived) {
              newConstructor.params = [t.restElement(t.identifier("args"))];
              newConstructor.body.body.push(
                t.returnStatement(
                  t.callExpression(
                    t.super(),
                    [t.spreadElement(t.identifier("args"))]
                  )
                )
              );
            }
            [constructor] = body.unshiftContainer("body", newConstructor);
          }

          let collisionState = {
            collision: false,
            scope: constructor.scope
          };

          for (let prop of props) {
            prop.traverse(referenceVisitor, collisionState);
            if (collisionState.collision) break;
          }

          if (collisionState.collision) {
            let initialisePropsRef = path.scope.generateUidIdentifier("initialiseProps");

            nodes.push(t.variableDeclaration("var", [
              t.variableDeclarator(
                initialisePropsRef,
                t.functionExpression(null, [], t.blockStatement(instanceBody))
              )
            ]));

            instanceBody = [
              t.expressionStatement(
                t.callExpression(t.memberExpression(initialisePropsRef, t.identifier("call")), [t.thisExpression()])
              )
            ];
          }

          //

          if (isDerived) {
            let bareSupers = [];
            constructor.traverse(findBareSupers, bareSupers);
            for (let bareSuper of bareSupers) {
              bareSuper.insertAfter(instanceBody);
            }
          } else {
            constructor.get("body").unshiftContainer("body", instanceBody);
          }
        }

        for (let prop of props) {
          prop.remove();
        }

        if (!nodes.length) return;

        if (path.isClassExpression()) {
          path.scope.push({ id: ref });
          path.replaceWith(t.assignmentExpression("=", ref, path.node));
        } else { // path.isClassDeclaration()
          if (!path.node.id) {
            path.node.id = ref;
          }

          if (path.parentPath.isExportDeclaration()) {
            path = path.parentPath;
          }
        }

        path.insertAfter(nodes);
      },
      ArrowFunctionExpression(path) {
        let classExp = path.get("body");
        if (!classExp.isClassExpression()) return;

        let body = classExp.get("body");
        let members = body.get("body");
        if (members.some((member) => member.isClassProperty())) {
          path.ensureBlock();
        }
      }
    }
  };
}
