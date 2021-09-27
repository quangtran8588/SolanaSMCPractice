/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

const {
  Keypair, Connection, PublicKey, LAMPORTS_PER_SOL,
  SystemProgram, TransactionInstruction, Transaction,
  sendAndConfirmTransaction
} = require('@solana/web3.js');
const fs = require('mz');
const path = require('path');
const borsh = require('borsh');
const { getPayer, getRpcUrl, createKeypairFromFile } = require('./utils');
const { Buffer } = require('buffer');
const BN = require('bn.js');
const assert = require('assert');
const BufferLayout = require('buffer-layout');

/**
 * Connection to the network
 */
let connection;

/**
 * Keypair associated to the fees' payer
 */
let payer;

/**
 * Hello world's program id
 */
let programId;

/**
 * The public key of the account we are saying hello to
 */
let greetedPubkey;

/**
 * Path to program files
 */
const PROGRAM_PATH = path.resolve(__dirname, '../../dist/program');

/**
 * Path to program shared object file which should be deployed on chain.
 * This file is created when running either:
 *   - `npm run build:program-c`
 *   - `npm run build:program-rust`
 */
const PROGRAM_SO_PATH = path.join(PROGRAM_PATH, 'helloworld.so');

/**
 * Path to the keypair of the deployed program.
 * This file is created when running `solana program deploy dist/program/helloworld.so`
 */
const PROGRAM_KEYPAIR_PATH = path.join(PROGRAM_PATH, 'helloworld-keypair.json');

/**
 * The state of a greeting account managed by the hello world program
 */
class Account {
  constructor(balance, name, symbol) {
    this.balance = balance;
    this.name = name;
    this.symbol = symbol;
  }
}

/**
 * Borsh schema definition for greeting accounts
 */
const AccountSchema = new Map(
  [
    [
      Account,
      {
        kind: 'struct',
        fields: [
          ['name', 'string'],
          ['symbol', 'string'],
          ['balance', 'u64']
        ]
      }
    ]
  ]
);

const value = new Account(0, 'Tether', 'USDT');

/**
 * The expected size of each greeting account.
 */
const ACCOUNT_SIZE = borsh.serialize(AccountSchema, value).length;

class u64 extends BN {
  /**
   * Convert to Buffer representation
   */
  toBuffer() {
    const a = super.toArray().reverse();
    const b = Buffer.from(a);
    if (b.length === 8) {
      return b;
    }
    assert(b.length < 8, 'u64 too large');

    const zeroPad = Buffer.alloc(8);
    b.copy(zeroPad);
    return zeroPad;
  }

  /**
   * Construct a u64 from Buffer representation
   */
  static fromBuffer(buffer) {
    assert(buffer.length === 8, `Invalid buffer length: ${buffer.length}`);
    return new u64(
      [...buffer]
        .reverse()
        .map(i => `00${i.toString(16)}`.slice(-2))
        .join(''),
      16,
    );
  }
}

const uint64 = (property = 'uint64') => {
  return BufferLayout.blob(8, property);
};

/**
 * Establish a connection to the cluster
 */
async function establishConnection() {
  const rpcUrl = await getRpcUrl();
  connection = new Connection(rpcUrl, 'confirmed');
  const version = await connection.getVersion();
  console.log('Connection to cluster established:', rpcUrl, version);
}

/**
 * Establish an account to pay for everything
 */
async function establishPayer() {
  let fees = 0;
  if (!payer) {
    const {feeCalculator} = await connection.getRecentBlockhash();

    // Calculate the cost to fund the greeter account
    fees += await connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE);

    // Calculate the cost of sending transactions
    fees += feeCalculator.lamportsPerSignature * 100; // wag

    payer = await getPayer();
  }

  let lamports = await connection.getBalance(payer.publicKey);
  if (lamports < fees) {
    // If current balance is not enough to pay for fees, request an airdrop
    const sig = await connection.requestAirdrop(
      payer.publicKey,
      fees - lamports,
    );
    await connection.confirmTransaction(sig);
    lamports = await connection.getBalance(payer.publicKey);
  }

  console.log(
    'Using account',
    payer.publicKey.toBase58(),
    'containing',
    lamports / LAMPORTS_PER_SOL,
    'SOL to pay for fees',
  );
}

/**
 * Check if the hello world BPF program has been deployed
 */
async function checkProgram() {
  // Read program id from keypair file
  try {
    const programKeypair = await createKeypairFromFile(PROGRAM_KEYPAIR_PATH);
    programId = programKeypair.publicKey;
  } catch (err) {
    const errMsg = err.message;
    throw new Error(
      `Failed to read program keypair at '${PROGRAM_KEYPAIR_PATH}' due to error: ${errMsg}. Program may need to be deployed with \`solana program deploy dist/program/helloworld.so\``,
    );
  }

  // Check if the program has been deployed
  const programInfo = await connection.getAccountInfo(programId);
  if (programInfo === null) {
    if (fs.existsSync(PROGRAM_SO_PATH)) {
      throw new Error(
        'Program needs to be deployed with `solana program deploy dist/program/helloworld.so`',
      );
    } else {
      throw new Error('Program needs to be built and deployed');
    }
  } else if (!programInfo.executable) {
    throw new Error(`Program is not executable`);
  }
  console.log(`Using program ${programId.toBase58()}`);

  // Derive the address (public key) of a greeting account from the program so that it's easy to find later.
  const GREETING_SEED = 'hello';
  greetedPubkey = await PublicKey.createWithSeed(
    payer.publicKey,
    GREETING_SEED,
    programId,
  );

  // Check if the greeting account has already been created
  const greetedAccount = await connection.getAccountInfo(greetedPubkey);
  if (greetedAccount === null) {
    console.log(
      'Creating account',
      greetedPubkey.toBase58(),
      'to mint Tokens to',
    );
    const lamports = await connection.getMinimumBalanceForRentExemption(
      ACCOUNT_SIZE,
    );

    const transaction = new Transaction().add(
      SystemProgram.createAccountWithSeed({
        fromPubkey: payer.publicKey,
        basePubkey: payer.publicKey,
        seed: GREETING_SEED,
        newAccountPubkey: greetedPubkey,
        lamports,
        space: ACCOUNT_SIZE,
        programId,
      }),
    );
    await sendAndConfirmTransaction(connection, transaction, [payer]);
  }
}

/**
 * Say hello
 */
async function mintTo() {
  const amount = 1000000000000;
  const dataLayout = BufferLayout.struct([
    uint64('amount'),
  ])
  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode(
    {
      amount: new u64(amount).toBuffer(),
    },
    data,
  );
  console.log('Mint Tokens to', greetedPubkey.toBase58());
  const instruction = new TransactionInstruction({
    keys: [{pubkey: greetedPubkey, isSigner: false, isWritable: true}],
    programId,
    data: data,
  });
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(instruction),
    [payer],
  );
}

/**
 * Report the number of times the greeted account has been said hello to
 */
async function getBalance() {
  const accountInfo = await connection.getAccountInfo(greetedPubkey);
  if (accountInfo === null) {
    throw 'Error: cannot find the greeted account';
  }

  const account = borsh.deserialize(
    AccountSchema,
    Account,
    accountInfo.data,
  );

  console.log(account)

  // console.log(
  //   greetedPubkey.toBase58(),
  //   'has balance',
  //   account.balance.balance.toNumber(),
  //   'of',
  //   account.balance.symbol,
  // );
}

module.exports = { establishConnection, establishPayer, checkProgram, mintTo, getBalance}
