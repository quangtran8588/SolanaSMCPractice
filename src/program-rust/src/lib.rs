use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::{next_account_info, AccountInfo},
    entrypoint,
    entrypoint::ProgramResult,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use std::convert::TryInto;
use std::io::ErrorKind::InvalidData;

/// Define the type of state stored in accounts
#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct TokenInfo {
    pub name: String,
    pub symbol: String,
    pub total_supply: u64
}

#[derive(BorshSerialize, BorshDeserialize, Debug)]
pub struct Account {
    pub balance: u64
}

pub fn init_token_info() -> TokenInfo {
    TokenInfo {
        name: String::from("Tether"),
        symbol: String::from("USDT"),
        total_supply: 0
    }
}

pub fn init_account() -> Account {
    Account {
        balance: 0
    }
}

// Declare and export the program's entrypoint
entrypoint!(process_instruction);

// Program entrypoint's implementation
pub fn process_instruction(
    program_id: &Pubkey, // Public key of the account the hello world program was loaded into
    accounts: &[AccountInfo], // The account to say hello to
    _instruction_data: &[u8], // Ignored
) -> ProgramResult {
    msg!("Example program");

    let (&method, amount) = _instruction_data.split_first().ok_or(ProgramError::InvalidArgument)?;
    let amount = amount
        .get(..8)
        .and_then(|slice| slice.try_into().ok())
        .map(u64::from_le_bytes)
        .ok_or(ProgramError::InvalidArgument)?;

    if method == 1 {
        mint_token(program_id, accounts, amount);
    } else if method == 2 {
        transfer_token(program_id, accounts, amount);
    }
    Ok(())
}

fn transfer_token(
    program_id: &Pubkey, // Public key of the account the hello world program was loaded into
    accounts: &[AccountInfo], // The account to say hello to
    amount: u64, 
) -> ProgramResult {
    msg!("Request transferring {} Tokens", amount); 

    // Iterating accounts is safer then indexing
    let accounts_iter = &mut accounts.iter();

    // Get the account to add balance
    let from = next_account_info(accounts_iter)?;
    let to = next_account_info(accounts_iter)?;

    if !from.is_signer {
        return Err(ProgramError::MissingRequiredSignature);
    }

    if from.owner != program_id {
        msg!("Sender account does not have the correct program id");
        return Err(ProgramError::IncorrectProgramId);
    }

    // The account must be owned by the program in order to modify its data
    if to.owner != program_id {
        msg!("Receiver account does not have the correct program id");
        return Err(ProgramError::IncorrectProgramId);
    }

    let mut sender_wallet = match Account::try_from_slice(&from.data.borrow_mut()){
        Ok(data) => data,
        Err(err) => {
            if err.kind() == InvalidData {
                msg!("InvalidData so initializing data");
                init_account()
            }else {
                panic!("Error: {}", err)
            }
        }
    };
        
    // Increment and store the number of times the account has been greeted
    let mut receiver_wallet = match Account::try_from_slice(&to.data.borrow_mut()) {
        Ok(data) => data,
        Err(err) => {
            if err.kind() == InvalidData {
                msg!("InvalidData so initializing data");
                init_account()
            }else {
                panic!("Error: {}", err)
            }
        }
    };

    msg!("Sender Balance Before: {}", sender_wallet.balance); 
    msg!("Receiver Balance before: {}", receiver_wallet.balance); 

    sender_wallet.balance = sender_wallet.balance
        .checked_sub(amount)
        .ok_or(ProgramError::InvalidInstructionData)?;

    receiver_wallet.balance = receiver_wallet.balance
        .checked_add(amount)
        .ok_or(ProgramError::InvalidInstructionData)?;

    msg!("Sender Balance After: {}", sender_wallet.balance);
    msg!("Receiver Balance After: {}", receiver_wallet.balance);

    let update_sender_wallet = sender_wallet.try_to_vec().expect("Fail to encode data");
    let sender_wallet_data = &mut &mut from.data.borrow_mut();
    sender_wallet_data[..].copy_from_slice(&update_sender_wallet);

    msg!("Done update sender wallet");

    let update_receiver_wallet = receiver_wallet.try_to_vec().expect("Fail to encode data");
    let receiver_wallet_data = &mut &mut to.data.borrow_mut();
    receiver_wallet_data[..].copy_from_slice(&update_receiver_wallet);

    msg!("Tranfer {} Tokens from {} to {} !", amount, from.key, to.key);
    Ok(()) 
}

fn mint_token(
    program_id: &Pubkey, // Public key of the account the hello world program was loaded into
    accounts: &[AccountInfo], // The account to say hello to
    amount: u64, 
) -> ProgramResult {
    msg!("Request minting {} Tokens", amount);  

    // Iterating accounts is safer then indexing
    let accounts_iter = &mut accounts.iter();

    // Get the account to add balance
    let token_holder = next_account_info(accounts_iter)?;
    let account = next_account_info(accounts_iter)?;

    if token_holder.owner != program_id {
        msg!("Token Holder account does not have the correct program id");
        return Err(ProgramError::IncorrectProgramId);
    }

    // The account must be owned by the program in order to modify its data
    if account.owner != program_id {
        msg!("Minting account does not have the correct program id");
        return Err(ProgramError::IncorrectProgramId);
    }

    let mut info = match TokenInfo::try_from_slice(&token_holder.data.borrow_mut()){
        Ok(data) => data,
        Err(err) => {
            if err.kind() == InvalidData {
                msg!("InvalidData so initializing data");
                init_token_info()
            }else {
                panic!("Error: {}", err)
            }
        }
    };
        
    // Increment and store the number of times the account has been greeted
    let mut wallet = match Account::try_from_slice(&account.data.borrow_mut()) {
        Ok(data) => data,
        Err(err) => {
            if err.kind() == InvalidData {
                msg!("InvalidData so initializing data");
                init_account()
            }else {
                panic!("Error: {}", err)
            }
        }
    };

    msg!("Token Name {}", info.name); 
    msg!("Total Supply Before: {}", info.total_supply); 
    msg!("Balance before: {}", wallet.balance); 

    wallet.balance = wallet.balance
        .checked_add(amount)
        .ok_or(ProgramError::InvalidInstructionData)?;

    info.total_supply = info.total_supply
        .checked_add(amount)
        .ok_or(ProgramError::InvalidInstructionData)?;

    msg!("Total Supply After: {}", info.total_supply);
    msg!("Balance after: {}", wallet.balance);

    let update_wallet_balance = wallet.try_to_vec().expect("Fail to encode data");
    let wallet_data = &mut &mut account.data.borrow_mut();
    wallet_data[..].copy_from_slice(&update_wallet_balance);
    // wallet.serialize(&mut &mut account.data.borrow_mut()[..])?;

    msg!("Done update wallet");

    let update_info = info.try_to_vec().expect("Fail to encode data");
    let info_data = &mut &mut token_holder.data.borrow_mut();
    info_data[..].copy_from_slice(&update_info);

    msg!("Minted {} of {} Tokens to {} !", amount, info.symbol, account.key);
    let err = 0;
    if err == 0 {
        msg!("Just Error");
        return Err(ProgramError::IncorrectProgramId);
    }
    Ok(())
}

// Sanity tests
#[cfg(test)]
mod test {
    use super::*;
    use solana_program::clock::Epoch;
    use std::mem;

    #[test]
    fn test_sanity() {
        let program_id = Pubkey::default();
        let key = Pubkey::default();
        let mut lamports = 0;
        let mut data = vec![0; mem::size_of::<u32>()];
        let owner = Pubkey::default();
        let account = AccountInfo::new(
            &key,
            false,
            true,
            &mut lamports,
            &mut data,
            &owner,
            false,
            Epoch::default(),
        );
        let instruction_data: Vec<u8> = Vec::new();

        let accounts = vec![account];

        assert_eq!(
            GreetingAccount::try_from_slice(&accounts[0].data.borrow())
                .unwrap()
                .counter,
            0
        );
        process_instruction(&program_id, &accounts, &instruction_data).unwrap();
        assert_eq!(
            GreetingAccount::try_from_slice(&accounts[0].data.borrow())
                .unwrap()
                .counter,
            1
        );
        process_instruction(&program_id, &accounts, &instruction_data).unwrap();
        assert_eq!(
            GreetingAccount::try_from_slice(&accounts[0].data.borrow())
                .unwrap()
                .counter,
            2
        );
    }
}
