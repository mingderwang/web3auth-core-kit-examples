import '@ethersproject/shims';
import {ethers} from 'ethers';

const providerUrl = 'https://rpc.ankr.com/eth'; // Or your desired provider url

const getChainId = async () => {
  try {
    const ethersProvider = ethers.getDefaultProvider(providerUrl);
    const networkDetails = await ethersProvider.getNetwork();
    return networkDetails;
  } catch (error) {
    return error;
  }
};

const getAccounts = async (privateKey: string) => {
  try {
    const wallet = new ethers.Wallet(privateKey);
    const address = await wallet.address;
    return address;
  } catch (error) {
    return error;
  }
};

const getBalance = async (privateKey: string) => {
  try {
    const ethersProvider = ethers.getDefaultProvider(providerUrl);
    const wallet = new ethers.Wallet(privateKey, ethersProvider);
    const balance = await wallet.getBalance();

    return balance;
  } catch (error) {
    return error;
  }
};

const sendTransaction = async (privateKey: string) => {
  try {
    const ethersProvider = ethers.getDefaultProvider(providerUrl);
    const wallet = new ethers.Wallet(privateKey, ethersProvider);

    const destination = '0x40e1c367Eca34250cAF1bc8330E9EddfD403fC56';

    // Convert 1 ether to wei
    const amount = ethers.utils.parseEther('0.001');

    // Submit transaction to the blockchain
    const tx = await wallet.sendTransaction({
      to: destination,
      value: amount,
      maxPriorityFeePerGas: '5000000000', // Max priority fee per gas
      maxFeePerGas: '6000000000000', // Max fee per gas
    });

    return tx;
  } catch (error) {
    return error;
  }
};

const signMessage = async (privateKey: string) => {
  try {
    const ethersProvider = ethers.getDefaultProvider(providerUrl);
    const wallet = new ethers.Wallet(privateKey, ethersProvider);

    const originalMessage = 'YOUR_MESSAGE';

    // Sign the message
    const signedMessage = await wallet.signMessage(originalMessage);

    return signedMessage;
  } catch (error) {
    return error;
  }
};

export default {
  getChainId,
  getAccounts,
  getBalance,
  sendTransaction,
  signMessage,
};
