
var _ = require('underscorem')

var fs = require('fs')

//var dir = 'test';
process.chdir('test')

var util = require('util')

var file_matcher = /\.js$/;

files = fs.readdirSync('.').map(function(file) {
    return file;
}).filter(function(file) {
    return !(/(^\.)|(\/\.)/.test(file));
});

files = files.filter(function(file) {
    return file.match(file_matcher);
});

console.log('files: ' + JSON.stringify(files))

function each(obj, cb){Object.keys(obj).forEach(function(key){cb(obj[key], key);})}

var all = {sub: {}, tests: {}, environments: []}
var testList = []
var environments = []
var instanceNameStates = {}

function processTests(tests, contextKey, depth){
	var context = {key: contextKey, tests: {}, sub: {}, environments: []};
	//console.log('processing tests: ' + contextKey + ' ' + JSON.stringify(Object.keys(tests)))
	if(tests.environments){
		var envs = tests.environments;
		_.assertArray(envs)
		envs.forEach(function(env){
			_.assertArray(env)
			var e = [];
			context.environments.push(e)
			env.forEach(function(instanceType){
				e.push(instanceType);
			})
		})
	}else{
		/*if(depth === 0){
			console.log('inserted basic environment')
			var e = [{
			}];
			context.environments.push(e)
		}*/
	}
	each(tests, function(test, key){
		if(key === 'environments'){
			return;
		}else if(_.isFunction(test) || _.isArray(test)){
			var t = context.tests[key] = {key: key, pre: [], not: [], reqs: [], parent: context};
			testList.push(t)
			if(_.isFunction(test)){
				t.f = test;
			}else{
				t.f = test[test.length-1];
				_.assertFunction(t.f);
				test.slice(0,test.length-1).forEach(function(precondition){
					if(_.isFunction(precondition)){
						//console.log('added prefunction')
						//t.preFunctions.push(precondition);
						t.reqs.push(precondition)
					}else{
						_.assertString(precondition)
						if(precondition.charAt(0) === '!'){
							if(precondition === '!'){
								t.forcedEntryOnly = true;
							}else{
								t.not.push(precondition.substr(1));
							}
						}else{
							//console.log('added pre')
							t.pre.push(precondition);
						}
					}
				})
			}
			testList
		}else{
			var subContext = processTests(test, key, depth+1);
			context.sub[key] = subContext;
			subContext.parent = context;
		}
	})
	return context;
}

files.forEach(function(file){
	var tests = require(process.cwd()+'/'+file)
	var context = processTests(tests, '', 0)
	//_.assertString(context.key)
	//_.assert(context.key.length > 0)
	each(context.sub, function(cc){
		all.sub[cc.key] = cc;
		cc.parent = all;
		
	})
	//all.sub[context.key] = context;
	//console.log('set context: ' + context.key)
	context.parent = all;
	
	all.environments = [[{many: 1}]];
})

function resolveName(n, start){
	var parts = n.split('.');
	if(parts.length === 1){
		if(instanceNameStates[n]){
			return instanceNameStates[n];
		}
		var res = start.tests[parts[0]]
		return res;
	}else{
		var first = parts[0];
		var rest = parts.slice(1);
		var subName = rest.join('.')

		if(start.sub[first]){
			var res = resolveName(subName, start.sub[first])
			if(res){
				//console.log('resolved: ' + subName)
				return res;
			}
		}
		if(start.parent){
			var res = resolveName(n, start.parent);
			if(res){
				//console.log('resolved: ' + n)
				return res;
			}
		}
	}
	_.errout('cannot resolve name: ' + n);
}

function resolveExpression(n, t, cb){

	var angleIndex = n.indexOf('>');	
	if(n.indexOf('|') !== -1){
		var parts = n.split('|');
		var funcs = [];
		parts.forEach(function(p){
			p = p.trim();
			if(p.length === 0) return;
			console.log('p: ' + p)
			resolveExpression(p, t, function(f){
				funcs.push(f);
			});
		})
		cb(function(prevs){
			for(var i=0;i<funcs.length;++i){
				var f = funcs[i];
				if(f(prevs)) return true;
			}
			return false;
		})
	}else if(n.indexOf(',') !== -1){
		if(n.indexOf(',') === n.length-1){
			var res = resolveName(n.substr(0, n.length-1), t.parent)
			cb(function(prevs){
				if(prevs.length > 0 && prevs[prevs.length-1] === res) return true;
				return false;
			})
		}else{
			_.errout('TODO')
		}
	}else if(angleIndex !== -1){
		var earlier = n.substr(0, angleIndex);
		var later = n.substr(angleIndex+1);
		earlier = resolveName(earlier, t.parent)
		later = resolveName(later, t.parent)
		cb(function(prevs){
			var ei = prevs.lastIndexOf(earlier)
			var li = prevs.lastIndexOf(later)
			var res = (ei === -1 && li !== -1) || li > ei
			var names = _.map(prevs, function(ps){return ps.key;})
			//console.log(earlier.key +'>'+later.key+': ' + res + ' (' + ei + '>' + li + ')');
			//console.log(JSON.stringify(names))
			return res;
		})
		
	}else{
		var res = resolveName(n, t.parent)
		if(res === undefined) _.errout('cannot resolve name: ' + n)
		cb(function(prevs){
			for(var i=0;i<prevs.length;++i){
				var p = prevs[i];
				if(p === res) return true;
			}
		})
	}
}
function resolve(t){
	//console.log('resolving: ' + t.key)
	t.pre.forEach(function(n, index){
		resolveExpression(n, t, function(f){
			t.reqs.push(f);
		})
	})
	t.not.forEach(function(n, index){
		var res = resolveName(n, t.parent)
		if(res === undefined) _.errout('cannot resolve name: ' + n)
		//console.log('!resolved: ' + n + ' -> ' + res.key)
		//t.not[index] = res
		t.reqs.push(function(prevs){
			for(var i=0;i<prevs.length;++i){
				var p = prevs[i];
				if(p === res) return false;
			}
			return true;
		})
	})
}
function hasParent(s, c){
	if(s.parent === c) return true;
	if(s.parent) return hasParent(s.parent, c);
	return false;
}
function nearestEnvironmentSource(s){
	if(!s.parent) return;
	if(s.parent.environments && s.parent.environments.length > 0) return s.parent;
	return nearestEnvironmentSource(s.parent)
}
function processContext(c){

	console.log('processing environments: ' + c.environments.length)
	c.environments.forEach(function(env){
		_.assertDefined(env)
		environments.push(env);
		env.parent = c;
		env.forEach(function(instanceType){
			if(instanceType.name){
				_.assertUndefined(instanceNameStates[instanceType.name])
				instanceType.state = instanceNameStates[instanceType.name] = {key: instanceType.name}
			}
		})
	})
	each(c.sub, function(s, key){
		console.log('key: ' + key)
		processContext(s);
	})
	each(c.tests, function(t, key){
		_.assertUndefined(t.tests)
		if(t.tests){
			console.log('key: ' + key)
			processContext(t)
		}else{
			resolve(t);
		}
	})

	c.environments.forEach(function(env){
		env.stateList = [];
		testList.forEach(function(t){
			if(nearestEnvironmentSource(t) === c){
				env.stateList.push(t);
			}
		})
	})
}
processContext(all)

exports.tree = all;
exports.testList = testList
exports.environments = environments;

