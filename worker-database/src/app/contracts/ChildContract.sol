// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title ChildContract
 * @dev Gas-optimized contract to transfer funds to a recipient and self-destruct
 */
contract ChildContract {
    /**
     * @dev Constructor transfers funds to recipient and self-destructs
     * Gas-optimized with minimal checks since it's called from MainContract
     * @param recipient Address to receive funds
     */
    constructor(address payable recipient) payable {
        require(recipient != address(0), "ZeroRecipient");
        
        // Use lower-level call for gas efficiency
        (bool success,) = recipient.call{value: msg.value}("");
        require(success, "TransferFailed");
        
        // Self-destruct to recover gas
        selfdestruct(payable(msg.sender));
    }
}