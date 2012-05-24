#! /usr/bin/env node

var inquisitor = require('./inquisitor')

var extended = inquisitor.extend({
	cluster: function(cluster, envDef, doneCb){
		doneCb()
	},
	instance: function(cluster, instance, instanceDef, doneCb){
		doneCb()
	},
	test: function(cluster, instance, testFunction, instanceDef){
		return function(done){
			testFunction(done)
		}
	},
	error: function(err, stateName, previousStates){
		_.errout(err);
	}
});

extended.run();

