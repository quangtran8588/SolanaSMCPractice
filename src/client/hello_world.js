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

/**
 * Hello world's program id
 */
let programId;

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
class TokenInfo {
  constructor(fields) {
    this.name = fields.name;
    this.symbol = fields.symbol;
    this.total_supply = fields.total_supply;
  }
}

class Account {
  constructor(fields) {
    this.balance = fields.balance;
  }
}

/**
 * Borsh schema definition for greeting accounts
 */
const TokenInfoSchema = new Map(
  [
    [
      TokenInfo,
      {
        kind: 'struct',
        fields: [
          ['name', 'string'],
          ['symbol', 'string'],
          ['total_supply', 'u64']
        ]
      }
    ]
  ]
);

const AccountSchema = new Map(
  [
    [
      Account,
      {
        kind: 'struct',
        fields: [
          ['balance', 'u64']
        ]
      }
    ]
  ]
);

const token_info = new TokenInfo( {name: 'Tether', symbol: 'USDT', total_supply: 0} );
const account_info = new Account( {balance: 0} );

/**
 * The expected size of each greeting account.
 */
const ACCOUNT_SIZE = borsh.serialize(AccountSchema, account_info).length;
const TOKEN_INFO_SIZE = borsh.serialize(TokenInfoSchema, token_info).length;

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
async function establishPayer(file) {
  let fees = 0;
  let payer;
  if (!payer) {
    const {feeCalculator} = await connection.getRecentBlockhash();

    // Calculate the cost to fund the greeter account
    fees += await connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE);

    // Calculate the cost of sending transactions
    fees += feeCalculator.lamportsPerSignature * 100; // wag

    payer = await getPayer(file);
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

  return payer;
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

  return programId;
}

async function create_account(main_account, seedMsg, programId, size) {
  let account = await PublicKey.createWithSeed(
    main_account.publicKey,
    seedMsg,
    programId,
  );
  const accountInfo = await connection.getAccountInfo(account);
  if (accountInfo === null) {
    console.log(
      'Creating new account',
      account.toBase58(),
      'derive from program',
      programId.toBase58()
    );
    const lamports = await connection.getMinimumBalanceForRentExemption(size);

    const transaction = new Transaction().add(
      SystemProgram.createAccountWithSeed({
        fromPubkey: main_account.publicKey,
        basePubkey: main_account.publicKey,
        seed: seedMsg,
        newAccountPubkey: account,
        lamports,
        space: size,
        programId,
      }),
    );
    await sendAndConfirmTransaction(connection, transaction, [main_account]);
  }
  return account.toBase58();
}

/**
 * Say hello
 */
async function mint(signer, token_holder, account, amount) {
  const holderPubkey = new PublicKey(token_holder);
  const accountPubkey = new PublicKey(account);
  const dataLayout = BufferLayout.struct([
    BufferLayout.u8('method'),
    uint64('amount'),
  ])
  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode(
    {
      method: 1,
      amount: new u64(amount).toBuffer(),
    },
    data,
  );
  console.log('Mint Tokens to', account);
  const instruction = new TransactionInstruction({
    keys: [
      {pubkey: holderPubkey, isSigner: false, isWritable: true},
      {pubkey: accountPubkey, isSigner: false, isWritable: true},
    ],
    programId,
    data: data,
  });
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(instruction),
    [signer],
  );
}

async function transfer(signer, from, to, amount) {
  const senderPubkey = new PublicKey(from);
  const receiverPubkey = new PublicKey(to);
  const dataLayout = BufferLayout.struct([
    BufferLayout.u8('method'),
    uint64('amount'),
  ])
  const data = Buffer.alloc(dataLayout.span);
  dataLayout.encode(
    {
      method: 2,
      amount: new u64(amount).toBuffer(),
    },
    data,
  );
  console.log('Transfer Tokens from', from, 'to', to);
  console.log('Payer:', signer.publicKey.toBase58());
  const instruction = new TransactionInstruction({
    keys: [
      {pubkey: senderPubkey, isSigner: false, isWritable: true},
      {pubkey: receiverPubkey, isSigner: false, isWritable: true},
    ],
    programId,
    data: data,
  });
  await sendAndConfirmTransaction(
    connection,
    new Transaction().add(instruction),
    [signer],
  );
}

/**
 * Report the number of times the greeted account has been said hello to
 */
async function getBalance(account) {
  const accountPubkey = new PublicKey(account);
  const accountInfo = await connection.getAccountInfo(accountPubkey);
  if (accountInfo === null) {
    throw 'Error: cannot find the greeted account';
  }

  const balanceAcct = borsh.deserialize(
    AccountSchema,
    Account,
    accountInfo.data,
  );

  console.log(
    accountPubkey.toBase58(),
    'has balance',
    balanceAcct.balance.toNumber()
  );
}

async function getTotalSupply(token_holder) {
  const holderPubkey = new PublicKey(token_holder);
  const tokenInfo = await connection.getAccountInfo(holderPubkey);
  if (tokenInfo === null) {
    throw 'Error: cannot find the greeted account';
  }

  const info = borsh.deserialize(
    TokenInfoSchema,
    TokenInfo,
    tokenInfo.data,
  );

  console.log(
    holderPubkey.toBase58(),
    'has a total supply',
    info.total_supply.toNumber(),
    'of',
    info.symbol
  );
}

module.exports = { 
  establishConnection, establishPayer, checkProgram, mint, transfer, getBalance, getTotalSupply, create_account,
  ACCOUNT_SIZE, TOKEN_INFO_SIZE
}
