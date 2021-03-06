var inquirer = require("inquirer");
var gift = require("gift");
var fs = require("fs");
var async = require('async');
var shell = require("shelljs");
var path = require("path");
var rmdir = require("rmdir");
var request = require("request");
var valid_url = require("valid-url");
var fsExtra = require('fs-extra');
var AschJS = require('etm-js');
var accountHelper = require("../helpers/account.js");
var blockHelper = require("../helpers/block.js");
var dappHelper = require("../helpers/dapp.js");
var Api = require("../helpers/api.js");
var cryptoLib = require("../lib/crypto.js");

var templatePath = path.join(__dirname, "..", "template");

var dappCategories = [
	"Common",
	"Business",
	"Social",
	"Education",
	"Entertainment",
	"News",
	"Life",
	"Utilities",
	"Games"
];

function bip39Validator(input) {
	var done = this.async();

	if (!accountHelper.isValidSecret(input)) {
		done("Secret is not validated by BIP39");
		return;
	}

	done(null, true);
}

function assetNameValidator(input) {
	let done = this.async()
	if (!input || !/^[A-Z]{3,6}$/.test(input)) {
		return done('Invalid currency symbol')
	}
	done(null, true)
}

function amountValidator(input) {
	let done = this.async()
	if (!/^[1-9][0-9]*$/.test(input)) {
		return done('Amount should be integer')
	}
	done(null, true)
}

function precisionValidator(input) {
	let done = this.async()
	let precision = Number(input)
	if (!Number.isInteger(precision) || precision < 0 || precision > 16) {
		return done('Precision is between 0 and 16')
	}
	done(null, true)
}

async function prompt(question) {
	if (Array.isArray(question)) {
		return await inquirer.prompt(question)
	} else {
		let answer = await inquirer.prompt([question])
		return answer[question.name]
	}
}

async function createDAppMetaFile() {
	let answer = await prompt([{
			type: "input",
			name: "name",
			message: "Enter DApp name",
			required: true,
			validate: function (value) {
				var done = this.async();
				if (value.length == 0) {
					done("DApp name is too short, minimum is 1 character");
					return;
				}
				if (value.length > 32) {
					done("DApp name is too long, maximum is 32 characters");
					return;
				}
				return done(null, true)
			}
		},
		{
			type: "input",
			name: "description",
			message: "Enter DApp description",
			validate: function (value) {
				var done = this.async();

				if (value.length > 160) {
					done("DApp description is too long, maximum is 160 characters");
					return;
				}

				return done(null, true);
			}
		},
		{
			type: "input",
			name: "tags",
			message: "Enter DApp tags",
			validate: function (value) {
				var done = this.async();

				if (value.length > 160) {
					done("DApp tags is too long, maximum is 160 characters");
					return;
				}

				return done(null, true);
			}
		},
		{
			type: "rawlist",
			name: "category",
			required: true,
			message: "Choose DApp category",
			choices: dappCategories
		},
		{
			type: "input",
			name: "link",
			message: "Enter DApp link",
			required: true,
			validate: function (value) {
				var done = this.async();

				if (!valid_url.isUri(value)) {
					done("Invalid DApp link, must be a valid url");
					return;
				}
				if (value.indexOf(".zip") != value.length - 4) {
					done("Invalid DApp link, does not link to zip file");
					return;
				}
				if (value.length > 160) {
					return done("DApp link is too long, maximum is 160 characters");
				}

				return done(null, true);
			}
		},
		{
			type: "input",
			name: "icon",
			message: "Enter DApp icon url",
			validate: function (value) {
				var done = this.async();

				if (!valid_url.isUri(value)) {
					return done("Invalid DApp icon, must be a valid url");
				}
				var extname = path.extname(value);
				if (['.png', '.jpg', '.jpeg'].indexOf(extname) == -1) {
					return done("Invalid DApp icon file type");
				}
				if (value.length > 160) {
					return done("DApp icon url is too long, maximum is 160 characters");
				}

				return done(null, true);
			}
		},
		{
			type: "input",
			name: "delegates",
			message: "Enter number of dapp delegates (mininum 5))",
			validate: function (value) {
				var done = this.async();
				var n = Number(value);
				if (!Number.isInteger(n) || n < 5 || n > 101) {
					return done("Invalid number of delegates");
				}
				done(null, true);
			}
		},
		{
			type: "input",
			name: "unlockDelegates",
			message: "How many delegates are needed to unlock asset of a dapp?",
			validate: function (value) {
				var done = this.async();
				var n = Number(value);
				if (!Number.isInteger(n) || n < 3 || n > 101) {
					return done("Invalid unlockDelegates");
				}
				done(null, true);
			}
		}
	])

	// var accounts = []
	var secrets = []
	var delegates = []
	for (var i = 0; i < Number(answer.delegates); i++) {
		var account = cryptoLib.generateAddress()
		secrets.push(account.secret)
		delegates.push(account.publicKey)
	}
	var configMetaInfo = {
		peers: [],
		secrets: secrets
	}
	var configMetaJson = JSON.stringify(configMetaInfo, null, 2);
	fs.writeFileSync("./config.json", configMetaJson, "utf8");
	console.log("DApp config secrets is saved to ./config.json ...");
	var dappMetaInfo = {
		name: answer.name,
		link: answer.link,
		category: dappCategories.indexOf(answer.category) + 1,
		description: answer.description || "",
		tags: answer.tags || "",
		icon: answer.icon || "",
		delegates: delegates,
		unlockDelegates: Number(answer.unlockDelegates),
		type: 0
	}
	var dappMetaJson = JSON.stringify(dappMetaInfo, null, 2);
	fs.writeFileSync("./dapp.json", dappMetaJson, "utf8");
	console.log("DApp meta information is saved to ./dapp.json ...");
}

async function addDapp() {
	console.log('Copying template to the current directory ...')
	shell.cp('-R', templatePath + '/*', '.')
	await createDAppMetaFile()
	await createGenesisBlock()
}

async function depositDapp() {
	let result = await inquirer.prompt([{
			type: "password",
			name: "secret",
			message: "Enter secret",
			validate: bip39Validator,
			required: true
		},
		{
			type: "input",
			name: "amount",
			message: "Enter amount",
			validate: function (value) {
				return !isNaN(parseInt(value));
			},
			required: true
		},
		{
			type: "input",
			name: "dappId",
			message: "DApp Id",
			required: true
		},
		{
			type: "input",
			name: "secondSecret",
			message: "Enter secondary secret (if defined)",
			validate: function (message) {
				return message.length < 100;
			},
			required: false
		}
	]);


	var realAmount = parseFloat((parseInt(result.amount) * 100000000).toFixed(0));
	var body = {
		secret: result.secret,
		dappId: result.dappId,
		amount: realAmount
	};

	if (result.secondSecret && result.secondSecret.length > 0) {
		body.secondSecret = result.secondSecret;
	}

	let hostResult = await inquirer.prompt([{
		type: "input",
		name: "host",
		message: "Host and port",
		default: "localhost:4096",
		required: true
	}]);

	request({
		url: "http://" + hostResult.host + "/api/dapps/transaction",
		method: "put",
		json: true,
		body: body
	}, function (err, resp, body) {

		if (err) {
			return console.log(err.toString());
		}

		if (body.success) {
			console.log(body.transactionId);
			return;
		} else {
			return console.log(body.error);
		}
	});
}

async function withdrawalDapp() {
	let result = await inquirer.prompt([{
			type: "password",
			name: "secret",
			message: "Enter secret",
			validate: bip39Validator,
			required: true
		},
		{
			type: "input",
			name: "amount",
			message: "Amount",
			validate: function (value) {
				return !isNaN(parseInt(value));
			},
			required: true
		},
		{
			type: "input",
			name: "dappId",
			message: "Enter DApp id",
			validate: function (value) {
				var isAddress = /^[0-9]+$/g;
				return isAddress.test(value);
			},
			required: true
		}
	]);

	var body = {
		secret: result.secret,
		amount: Number(result.amount)
	};

	request({
		url: "http://localhost:4096/api/dapps/" + result.dappId + "/api/withdrawal",
		method: "post",
		json: true,
		body: body
	}, function (err, resp, body) {
		if (err) {
			return console.log(err.toString());
		}

		if (body.success) {
			console.log(body.transactionId);
		} else {
			return console.log(body.error);
		}
	});
}

async function uninstallDapp() {
	let result = await inquirer.prompt([{
			type: "input",
			name: "dappId",
			message: "Enter dapp id",
			validate: function (value) {
				return value.length > 0 && value.length < 100;
			},
			required: true
		},
		{
			type: "input",
			name: "host",
			message: "Host and port",
			default: "localhost:4096",
			required: true
		},
		{
			type: "password",
			name: "masterpassword",
			message: "Enter dapp master password",
			required: true
		}
	]);

	var body = {
		id: String(result.dappId),
		master: String(result.masterpassword)
	};

	request({
		url: "http://" + result.host + "/api/dapps/uninstall",
		method: "post",
		json: true,
		body: body
	}, function (err, resp, body) {
		if (err) {
			return console.log(err.toString());
		}

		if (body.success) {
			console.log("Done!");
		} else {
			return console.log(body.error);
		}
	});
}

async function installDapp() {
	let result = await inquirer.prompt([{
			type: "input",
			name: "dappId",
			message: "Enter dapp id",
			validate: function (value) {
				return value.length > 0 && value.length < 100;
			},
			required: true
		},
		{
			type: "input",
			name: "host",
			message: "Host and port",
			default: "localhost:4096",
			required: true
		},
		{
			type: "input",
			name: "masterpassword",
			message: "Enter dapp master password",
			required: true
		}
	]);

	var body = {
		id: String(result.dappId),
		master: String(result.masterpassword)
	};

	request({
		url: "http://" + result.host + "/api/dapps/install",
		method: "post",
		json: true,
		body: body
	}, function (err, resp, body) {
		if (err) {
			return console.log(err.toString());
		}

		if (body.success) {
			console.log("Done!", body.path);
		} else {
			return console.log(body.error);
		}
	});
}

async function createGenesisBlock() {
	var genesisSecret = await prompt({
		type: "password",
		name: "genesisSecret",
		message: "Enter master secret of your genesis account",
		validate: bip39Validator
	})

	var wantInbuiltAsset = await inquirer.prompt({
		type: "confirm",
		name: "wantInbuiltAsset",
		message: "Do you want publish a inbuilt asset in this dapp?",
		default: false
	})

	var assetInfo = null
	if (wantInbuiltAsset.wantInbuiltAsset) {
		var name = await prompt({
			type: "input",
			name: "assetName",
			message: "Enter asset name, for example: BTC, CNY, USD, MYASSET",
			validate: assetNameValidator
		})
		var amount = await prompt({
			type: "input",
			name: "assetAmount",
			message: "Enter asset total amount",
			validate: amountValidator
		})
		var precision = await prompt({
			type: "input",
			name: "assetPrecison",
			message: "Enter asset precision",
			validate: precisionValidator
		})
		assetInfo = {
			name: name,
			amount: amount,
			precision: precision
		}
	}

	var account = accountHelper.account(genesisSecret)
	var dappBlock = dappHelper.new(account, null, assetInfo);
	var dappGenesisBlockJson = JSON.stringify(dappBlock, null, 2);
	fs.writeFileSync('genesis.json', dappGenesisBlockJson, "utf8");
	console.log("New genesis block is created at: ./genesis.json");
}

module.exports = function (program) {
	program
		.command("dapps")
		.description("manage your dapps")
		.option("-a, --add", "add new dapp")
		.option("-d, --deposit", "deposit funds to dapp")
		.option("-w, --withdrawal", "withdraw funds from dapp")
		.option("-i, --install", "install dapp")
		.option("-u, --uninstall", "uninstall dapp")
		.option("-g, --genesis", "create genesis block")
		.action(function (options) {
			(async function () {
				try {
					if (options.add) {
						addDapp();
					} else if (options.deposit) {
						depositDapp();
					} else if (options.withdrawal) {
						withdrawalDapp();
					} else if (options.install) {
						installDapp();
					} else if (options.uninstall) {
						uninstallDapp();
					} else if (options.genesis) {
						createGenesisBlock()
					} else {
						console.log("'node dapps -h' to get help");
					}
				} catch (e) {
					console.error(e)
				}
			})()
		});
}