var _ = require('underscorem')

var http = require('http')

var port = 8389;
//var already = false;

function setupServer(done){
	var server = http.createServer(function(req, res){
		var str = '';
		req.on('data', function(chunk){
			str += chunk;
		});
		req.on('end', function(){
			_.assertEqual('some text', str)
			res.writeHead(200);
			res.end('cool');
		})
	})
	server.listen(port, function(){
		done.server = server;
		done();
	})
}

function shutdownServer(done){
	done.server.on('close', done)
	done.server.close()
}

exports['inquisitor'] = {
	'example-http': {
		environments: [
			[
				{
					name: 'server',
					initial: setupServer,
					many: 1,
					globalMax: 1,
					cleanup: shutdownServer
				},
				{
					name: 'client',
					many: 2
				}
			]
		],
		run_client: ['client', function(done){
			var req = http.request({method: 'POST', port: port}, function(res){
				var str = '';
				res.on('data', function(chunk){
					str += chunk;
				})
				res.on('end', function(){
					_.assertEqual(str, 'cool')
					done('completed_client_ok');
				})
			});

			req.on('error', function(e){
				if(e.code === 'EADDRNOTAVAIL'){
					done('out_of_ephemeral_ports');
				}else{
					_.errout(e)
				}
			})
			
			req.write('some text')				
			req.end()
		}],
		out_of_ephemeral_ports: ['!', function(done){
			done()
		}],
		completed_client_ok: ['!', function(done){
			done()
		}]
	}
}
