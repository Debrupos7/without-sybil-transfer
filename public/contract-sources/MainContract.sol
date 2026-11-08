// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

/**
 * @title MainContract
 * @dev Contract for creating multiple child contracts with enhanced security features
 * Includes ownership management and whitelisting capabilities
 */
contract MainContract {
    address private _owner;
    mapping(address => bool) private _whitelistedUsers;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;
    uint256 private _status = _NOT_ENTERED;
    
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event WhitelistStatusChanged(address indexed user, bool status);
    event ChildContractCreated(address indexed childAddress, address indexed recipient, uint256 amount);

    /**
     * @dev Modifier to restrict function access to the contract owner only
     */
    modifier onlyOwner() {
        require(msg.sender == _owner, "NotOwner");
        _;
    }
    
    /**
     * @dev Modifier to restrict function access to whitelisted users or the owner
     */
    modifier onlyWhitelistedOrOwner() {
        require(msg.sender == _owner || _whitelistedUsers[msg.sender], "NotAuthorized");
        _;
    }
    
    /**
     * @dev Reentrancy guard modifier - optimized version
     */
    modifier nonReentrant() {
        require(_status != _ENTERED, "ReentrantCall");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }
    
    /**
     * @dev Constructor sets deployer as the initial owner
     */
    constructor() {
        _owner = msg.sender;
        emit OwnershipTransferred(address(0), _owner);
    }
    
    /**
     * @dev Returns the address of the current owner
     */
    function owner() public view returns (address) {
        return _owner;
    }
    
    /**
     * @dev Transfers ownership of the contract to a new account
     * @param newOwner The address of the new owner
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "ZeroAddress");
        emit OwnershipTransferred(_owner, newOwner);
        _owner = newOwner;
    }
    
    /**
     * @dev Adds or removes an address from the whitelist
     * @param user The address to modify whitelist status
     * @param status True to whitelist, false to remove from whitelist
     */
    function setWhitelistStatus(address user, bool status) external onlyOwner {
        require(user != address(0), "ZeroAddress");
        _whitelistedUsers[user] = status;
        emit WhitelistStatusChanged(user, status);
    }
    
    /**
     * @dev Batch whitelist multiple addresses
     * @param users Array of addresses to add to whitelist
     */
    function batchWhitelist(address[] calldata users) external onlyOwner {
        uint256 length = users.length;
        for (uint256 i = 0; i < length;) {
            address user = users[i];
            require(user != address(0), "ZeroAddress");
            _whitelistedUsers[user] = true;
            emit WhitelistStatusChanged(user, true);
            unchecked { ++i; }
        }
    }
    
    /**
     * @dev Checks if an address is whitelisted
     * @param user The address to check
     * @return bool True if address is whitelisted
     */
    function isWhitelisted(address user) external view returns (bool) {
        return _whitelistedUsers[user];
    }
    
    /**
     * @dev Creates multiple child contracts to send funds to multiple recipients
     * Gas-optimized version
     * @param recipients Array of recipient addresses
     * @param amounts Array of amounts to send to each recipient
     */
    function createMultipleChildContracts(
        address[] calldata recipients, 
        uint256[] calldata amounts
    ) external payable onlyWhitelistedOrOwner nonReentrant {
        uint256 recipientsLength = recipients.length;
        require(recipientsLength == amounts.length, "LengthMismatch");
        require(recipientsLength > 0, "EmptyArrays");
        
        uint256 totalAmount;
        for (uint256 i = 0; i < recipientsLength;) {
            address recipient = recipients[i];
            uint256 amount = amounts[i];
            
            require(recipient != address(0), "ZeroRecipient");
            require(amount > 0, "ZeroAmount");
            
            totalAmount += amount;
            unchecked { ++i; }
        }
        
        require(msg.value >= totalAmount, "InsufficientFunds");
        
        for (uint256 i = 0; i < recipientsLength;) {
            address recipient = recipients[i];
            uint256 amount = amounts[i];
            
            // Create child contract and send funds
            ChildContract child = new ChildContract{value: amount}(payable(recipient));
            emit ChildContractCreated(address(child), recipient, amount);
            unchecked { ++i; }
        }
        
        // Return excess funds using optimized refund
        uint256 excess = msg.value - totalAmount;
        if (excess > 0) {
            (bool success,) = payable(msg.sender).call{value: excess}("");
            require(success, "RefundFailed");
        }
    }
}

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