
var _ = require('underscorem')

exports['basic'] = {
	environments: [
		[
			{
				//initial: 'init',
				many: 1
			}
		]
	],
	init: ['!init', function(done){
		done.initialized = true;
		done();
	}],
	is_inited: ['!die', 'init', function(done){
		_.assert(done.initialized);
		done()
	}],
	ping: ['!die', 'init', function(d){return !d.ping;}, function(done){
		_.assertNot(done.ping)
		_.assert(done.ping === undefined || done.pong);

		if(Math.random() < .01 && !done.pong) throw new Error('random failure')

		done.pong = false;
		done.ping = true;
		done()
	}],
	pong: ['!die', 'init', 'ping', function(d){return !d.pong;}, function(done){
		_.assert(done.ping)
		done.pong = true;
		done.ping = false;
		done()
	}],
	die: ['!die', 'init', function(done){
		done.dead = true;
		done()
	}]
};
