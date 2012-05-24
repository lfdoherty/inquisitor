
var _ = require('underscorem')

var util = require('util')

var load = require('./load');
var testList = load.testList;
var tree = load.tree;
var environments = load.environments;

/*
1. find the state or states which have no pre-requisites
2. for each state in the previous set, create an instance
3. randomly apply a valid transition to the instance, or randomly give up
4. when number of active instances is less than K, create more.
*/

var openStates = []
testList.forEach(function(t){
	if(t.reqs.length === 0){
		openStates.push(t)
	}
})

function rand(n){_.assert(n>=1);return Math.floor(Math.random()*n)}

function chooseState(s, previousStates, stateList){
	var candidates = [];
	stateList.forEach(function(t){
		if(t.forcedEntryOnly) return;
		
		/*var failed = false;
		t.not.forEach(function(not){
			if(previousStates.indexOf(not) !== -1) failed = true
		})
		if(failed) return;
		t.pre.forEach(function(pre){
			if(previousStates.indexOf(pre) === -1){
				failed = true
			}
		})
		if(failed) return;
		t.preFunctions.forEach(function(pf){
			if(!pf(s)) failed = true
		})
		if(failed) return;*/
		var failed = false;
		t.reqs.forEach(function(f){
			if(!f(previousStates)) failed = true;
		})
		if(failed) return;
		candidates.push(t)
	})
	if(candidates.length === 0) return;
	var res = candidates[rand(candidates.length)];
	return res
}

var active = [];
var ready = [];
var waiting = []
var starting = []
var K = 10;
var deadClusters = 0;
var globalMany = {};

MaintainDelay = 1;

var stateCompletions = {}
var stateFailures = {}
var stateInProgress = {}

testList.forEach(function(t){
	stateCompletions[t.key] = 0;
	stateFailures[t.key] = 0;
	stateInProgress[t.key] = 0;
})

environments.forEach(function(env){
	env.forEach(function(it){
		if(it.state){
			stateCompletions[it.state.key] = 0;
			stateFailures[it.state.key] = 0;
			stateInProgress[it.state.key] = 0;
		}
		if(it.globalMax){
			globalMany[it.name] = 0;
		}
	})
})

function completed(s){
	_.assertString(s.key)
	++stateCompletions[s.key];
}
function failed(s, err){
	_.assertString(s.key)
	++stateFailures[s.key];
}

function workingOn(s, err){
	_.assertString(s.key)
	++stateInProgress[s.key];
}
function finished(s, err){
	_.assertString(s.key)
	--stateInProgress[s.key];
}

var ooo = console.log

exports.extend = function(config){
	_.assertFunction(config.error)
	_.assertFunction(config.success)
	
	function makeDoneFunction(instance, cluster){
		return function(newStateName){
			_.assertDefined(instance.state)
			completed(instance.state)
			instance.previousStates.push(instance.state);

			//ooo('done')
			finished(instance.state)

			try{
				config.success(instance.previousStates)
			}catch(e){
				console.log('error during config.success');
				console.log(e);
				console.log(e.stack)
				throw e;				
			}

			instance.state = undefined;

			var ii = waiting.indexOf(instance);
			if(ii >= 0){
				waiting.splice(ii, 1)	
			}

			if(newStateName !== undefined){
				instance.state = _.detect(testList, function(t){return t.key === newStateName;})
				_.assertDefined(instance.state)
				tryToRun(instance, cluster)
			}else{
				--cluster.runningInstances;
				if(cluster.runningInstances === 0){
					ready.push(cluster);
					//console.log('all instances done, ready')
				}
			}
		}
	}
	function finishMakeInstance(cluster, env){
	
		var manyWaiting = 0;
		var exitedSetup = false;
		var finished = false;
		
		cluster.making = true;
		
		//console.log('making ' + env.length + ' instances')
		_.assert(env.length >= 1)
		
		env.forEach(function(it){
	
			var m;
			if(_.isFunction(it.many)){
				m = it.many();
			}else{
				//_.assertInt(it.many)
				if(it.many === undefined){
					m = 1;
				}else{
					m = it.many;
				}
			}
			_.assert(m >= 1)
			if(it.globalMax){
				var currentMany = globalMany[it.name];
				if(m + currentMany >= it.globalMax){
					m = it.globalMax - currentMany;
				}
				_.assertString(it.name);
				globalMany[it.name] += m;
			}
			
			_.assert(m >= 1)
			
			_.times(m, function(){
				var instance = {previousStates: []};
				
				instance.error = function(err){
				
					console.log('error')

					var stateName = '<no state>';
					if(instance.failed) stateName = '<' + instance.failed + ' - further failures>';
					if(instance.state) stateName = instance.state.key
					
					try{				
						config.error(err, stateName, instance.previousStates, instance);
					}catch(e){
						console.log('error during config.error handler');
						console.log(e);
						console.log(e.stack)
						throw e;
					}
				
					instance.failed = stateName;

					if(instance.state){
						failed(instance.state, err);
					}
				
					instance.state = undefined;

					waiting.splice(waiting.indexOf(instance), 1)
					if(active.indexOf(cluster) !== -1){
						active.splice(active.indexOf(cluster), 1)
					}else{
						console.log('already removed')
					}
				}
				
				if(config.instance){
					++manyWaiting;
					config.instance(cluster, instance, it, function(){
						--manyWaiting;
						doRest()
						tryFinish();
					})
				}else{
					doRest()
				}
				function doRest(){
					//console.log('doing rest')
					instance.done = makeDoneFunction(instance, cluster)

					instance.it = it;


					if(it.initial){			

						++cluster.runningInstances;
						instance.state = it.state
						try{
							//console.log('doing setup')
							it.initial(instance.done);
						}catch(e){
							console.log('ERROR DURING SETUP')
							cluster.failedToMake = true;
							_.errout(e)
						}

					}else if(it.name){
						instance.previousStates.push(it.state)
						++stateCompletions[it.state.key];
					}
					if(instance.initialization === undefined) instance.initialization = '<none>'
					cluster.push(instance)
				}
			})
		})

		exitedSetup = true;

		tryFinish();
		
		function tryFinish(){
			//console.log('trying to finish*')
			
			if(!exitedSetup) return;
			if(manyWaiting !== 0) return;

			console.log('trying to finish: ' + manyWaiting)
			_.assert(cluster.length >= 1);
			
			finished = true;
			
			var ii = starting.indexOf(cluster);
			_.assert(ii >= 0)
			starting.splice(ii, 1);
		
			active.push(cluster)
	
			if(cluster.runningInstances === 0){
				cluster.making = false;
				ready.push(cluster)
			}else{
				console.log('delayed')
			}
		}
	}
	
	function makeInstance(){

		var cluster = [];
		cluster.runningInstances = 0
		_.assert(environments.length >= 1)
		var env = environments[rand(environments.length)];
		_.assertDefined(env)

		cluster.stateList = env.stateList;
	
		var failed = _.any(env, function(it){
			if(it.globalMax){
				_.assertString(it.name);
				return it.globalMax && globalMany[it.name] >= it.globalMax
			}
		})
	
		if(failed) return true;
		
		cluster.beingMade = true;
		
		starting.push(cluster)		
		
		if(config.cluster){
			cluster.waitingForExternalMake = true
			config.cluster(cluster, env, function(){
				cluster.waitingForExternalMake = false
				finishMakeInstance(cluster, env)
			})
		}else{
			finishMakeInstance(cluster, env)
		}
	
	}
	function tryToRun(instance, cluster){
		_.assertDefined(cluster)
		waiting.push(instance);

		workingOn(instance.state)

		try{
			if(config.test){
				var rf = config.test(cluster, instance, instance.state.f, instance.it);
				rf(instance.done)
			}else{
				instance.state.f(instance.done)
			}	
		}catch(e){
			//throw e
			
			/*if(instance.state)failed(instance.state, e);
			if(config.error){
				config.error(e, instance.state.key, instance.previousStates);
			}
			instance.state = undefined;

			waiting.splice(waiting.indexOf(instance), 1)
			if(active.indexOf(cluster) !== -1){
				active.splice(active.indexOf(cluster), 1)
			}else{
				console.log('already removed')
			}*/
			instance.error(e);
			return;
		}
	}

	var actStr = '';
	
	function maintain(){

		while(active.length + starting.length < K){
			var failed = makeInstance();
			if(failed) break;
		}
		var newActStr = '';
		newActStr += active.length + ' ' + starting.length + '\n';
		newActStr += 'starting:\n';
		for(var i=0;i<starting.length;++i){
			var c = starting[i];
			newActStr += c.making + ' ' + c.failedToMake + ' ' + c.beingMade + ' ' + c.waitingForExternalMake + '\n';
		}
		if(actStr !== newActStr){
			actStr = newActStr
			console.log(actStr);
		}

		var s = [].concat(ready);
		ready = [];
		s.forEach(function(cluster){

		//	console.log('running ready cluster: ' + cluster.length)
			
			var manyRun = 0;
			cluster.forEach(function(instance){
			
				var newState = chooseState(instance.done, instance.previousStates,cluster.stateList)
				var term = Math.random() < .05;
				if(newState !== undefined && !term){
					_.assertDefined(newState)
					instance.state = newState
					++cluster.runningInstances;
					++manyRun;
					tryToRun(instance, cluster);
				}
			})
			if(manyRun === 0){
				++deadClusters;
				active.splice(active.indexOf(cluster), 1)
				cluster.forEach(function(instance){
					if(instance.it.cleanup){
						var newDone = function(){
							if(instance.it.globalMax){
								--globalMany[instance.it.name];
							}
						};
						_.extend(newDone, instance.done);

						try{
							instance.it.cleanup(newDone)
						}catch(e){
							_.errout('TODO: ' + e);
						}
					}
				})
			}
		})
		setTimeout(maintain, MaintainDelay);
	}

	function run(){
		maintain()

		var lastStr = '';
		function report(){
			str = '';
			str += 'successes: ' + JSON.stringify(stateCompletions, null, 2)+'\n';
			str += ' failures: ' + JSON.stringify(stateFailures, null, 2)+'\n'
			str += ' in progress: ' + JSON.stringify(stateInProgress, null, 2)+'\n'
			str += ' in progress stacks: '
			
			waiting.forEach(function(instance){
				str += instance.inst.getLastStack()
				instance.error('test')
			})
			
			//console.log('reporting: ' + (str !== lastStr))
			if(str !== lastStr){
				lastStr = str;
				console.log(str);
			}
			//console.log(str);
		}

		setInterval(report, 500);
		report()
	}

	
	return {
		run: function(){
			run()
		}
	};
}


