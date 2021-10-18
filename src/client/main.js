/**
 * Hello world
 */

const { create } = require('ts-node');
const {
  establishConnection, establishPayer, checkProgram, mint, transfer, getBalance, getTotalSupply, create_account
} = require('./hello_world');

const {ACCOUNT_SIZE, TOKEN_INFO_SIZE} = require('./hello_world');

async function main() {
  console.log("Solana smart contract example.......");

  // Establish connection to the cluster
  await establishConnection();

  // Determine who pays for the fees
  let payer = await establishPayer('account1.json');
  let anotherPayer = await establishPayer('account2.json');

  let programId = await checkProgram();

  let token_holder = await create_account(payer, 'Token Holder', programId, TOKEN_INFO_SIZE);
  let mint_account = await create_account(payer, 'Mint Account', programId, ACCOUNT_SIZE);
  let receiver = await create_account(payer, 'Receiver Account', programId, ACCOUNT_SIZE);
  let anotherReceiver = await create_account(anotherPayer, 'Receiver 2', programId, ACCOUNT_SIZE);

  // Check if the program has been deployed
  // [token_holder, mint_account, receiver] = await checkProgram();

  // Mint Token to one account
  const mintAmt = 1000000000000;
  await mint(payer, token_holder, mint_account, mintAmt);

  // get balance of one account
  await getBalance(mint_account);

  // get the total suppy of Tokens
  await getTotalSupply(token_holder);

  // Transfer Tokens
  // const txAmt = 300000000000;
  // await transfer(payer, mint_account, receiver, txAmt);

  // // Check updated balances
  // await getTotalSupply(token_holder);
  // await getBalance(mint_account);
  // await getBalance(receiver);

  // Transfer Tokens
  // const anotherAmt = 250000000000;
  // await transfer(anotherPayer, mint_account, anotherReceiver, anotherAmt);

  // // Check updated balances
  // await getTotalSupply(token_holder);
  // await getBalance(mint_account);
  // await getBalance(receiver);
  // await getBalance(anotherReceiver);

  console.log('Success');
}

main().then(
  () => process.exit(),
  err => {
    console.error(err);
    process.exit(-1);
  },
);
