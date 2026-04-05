import SpriteKit

class GameScene: SKScene, SKPhysicsContactDelegate {

    // MARK: - Physics Categories

    private struct Category {
        static let ship: UInt32     = 0x1 << 0
        static let asteroid: UInt32 = 0x1 << 1
        static let star: UInt32     = 0x1 << 2
        static let powerup: UInt32  = 0x1 << 3
    }

    // MARK: - Properties

    private var ship: SKNode!
    private var scoreLabel: SKLabelNode!
    private var livesLabel: SKLabelNode!

    private var score = 0
    private var lives = 3
    private var isGameOver = false
    private var isInvincible = false
    private var difficultyTimer: TimeInterval = 0
    private var spawnInterval: TimeInterval = 1.2
    private var asteroidSpeed: TimeInterval = 4.0
    private var lastTouchPosition: CGPoint?

    // MARK: - Scene Lifecycle

    override func didMove(to view: SKView) {
        backgroundColor = SKColor(red: 0.05, green: 0.02, blue: 0.15, alpha: 1.0)

        physicsWorld.gravity = .zero
        physicsWorld.contactDelegate = self

        createStarfield()
        createShip()
        createHUD()
        startSpawning()
        startScoreTimer()
    }

    // MARK: - Setup

    private func createStarfield() {
        let emitter = SKEmitterNode()
        emitter.particleBirthRate = 8
        emitter.particleLifetime = 14
        emitter.particlePositionRange = CGVector(dx: size.width, dy: 0)
        emitter.emissionAngle = .pi * 1.5
        emitter.emissionAngleRange = 0.1
        emitter.particleSpeed = 50
        emitter.particleSpeedRange = 25
        emitter.particleAlpha = 0.7
        emitter.particleAlphaRange = 0.3
        emitter.particleScale = 0.04
        emitter.particleScaleRange = 0.03
        emitter.particleColor = .white
        emitter.particleColorBlendFactor = 1.0
        emitter.particleBlendMode = .add
        emitter.position = CGPoint(x: size.width / 2, y: size.height)
        emitter.advanceSimulationTime(10)
        emitter.zPosition = -1
        addChild(emitter)
    }

    private func createShip() {
        let shipEmoji = SKLabelNode(text: "\u{1F680}")
        shipEmoji.fontSize = 44
        shipEmoji.name = "ship"

        let shipBody = SKNode()
        shipBody.addChild(shipEmoji)
        shipBody.position = CGPoint(x: size.width / 2, y: size.height * 0.15)
        shipBody.zPosition = 10

        let body = SKPhysicsBody(circleOfRadius: 18)
        body.categoryBitMask = Category.ship
        body.contactTestBitMask = Category.asteroid | Category.star | Category.powerup
        body.collisionBitMask = 0
        body.isDynamic = true
        shipBody.physicsBody = body

        addChild(shipBody)
        ship = shipBody

        // Engine glow
        let glow = SKShapeNode(circleOfRadius: 8)
        glow.fillColor = SKColor(red: 0.3, green: 0.6, blue: 1.0, alpha: 0.5)
        glow.strokeColor = .clear
        glow.position = CGPoint(x: 0, y: -22)
        glow.zPosition = -1
        shipBody.addChild(glow)

        let pulse = SKAction.sequence([
            SKAction.fadeAlpha(to: 0.2, duration: 0.3),
            SKAction.fadeAlpha(to: 0.6, duration: 0.3)
        ])
        glow.run(.repeatForever(pulse))
    }

    private func createHUD() {
        scoreLabel = SKLabelNode(fontNamed: "AvenirNext-Bold")
        scoreLabel.text = "Score: 0"
        scoreLabel.fontSize = 20
        scoreLabel.fontColor = .white
        scoreLabel.horizontalAlignmentMode = .left
        scoreLabel.position = CGPoint(x: 16, y: size.height - 50)
        scoreLabel.zPosition = 100
        addChild(scoreLabel)

        livesLabel = SKLabelNode(fontNamed: "AvenirNext-Bold")
        livesLabel.fontSize = 20
        livesLabel.horizontalAlignmentMode = .right
        livesLabel.position = CGPoint(x: size.width - 16, y: size.height - 50)
        livesLabel.zPosition = 100
        updateLivesDisplay()
        addChild(livesLabel)
    }

    private func updateLivesDisplay() {
        livesLabel.text = String(repeating: "\u{2764}\u{FE0F}", count: max(lives, 0))
    }

    // MARK: - Spawning

    private func startSpawning() {
        let spawnAction = SKAction.run { [weak self] in
            self?.spawnObstacle()
        }
        let wait = SKAction.wait(forDuration: spawnInterval, withRange: 0.5)
        run(.repeatForever(.sequence([spawnAction, wait])), withKey: "spawning")

        // Spawn stars less frequently
        let starAction = SKAction.run { [weak self] in
            self?.spawnStar()
        }
        let starWait = SKAction.wait(forDuration: 3.0, withRange: 1.5)
        run(.repeatForever(.sequence([starAction, starWait])), withKey: "starSpawning")

        // Spawn shield powerups rarely
        let powerupAction = SKAction.run { [weak self] in
            self?.spawnPowerup()
        }
        let powerupWait = SKAction.wait(forDuration: 15.0, withRange: 5.0)
        run(.repeatForever(.sequence([powerupAction, powerupWait])), withKey: "powerupSpawning")

        // Increase difficulty over time
        let difficultyAction = SKAction.run { [weak self] in
            self?.increaseDifficulty()
        }
        let difficultyWait = SKAction.wait(forDuration: 5.0)
        run(.repeatForever(.sequence([difficultyWait, difficultyAction])), withKey: "difficulty")
    }

    private func spawnObstacle() {
        let asteroidEmojis = ["\u{2604}\u{FE0F}", "\u{1FA78}", "\u{1F30D}", "\u{1F311}"]
        let emoji = asteroidEmojis.randomElement() ?? "\u{2604}\u{FE0F}"

        let asteroid = SKLabelNode(text: emoji)
        asteroid.fontSize = CGFloat.random(in: 28...50)
        asteroid.name = "asteroid"

        let margin: CGFloat = 30
        let x = CGFloat.random(in: margin...(size.width - margin))
        asteroid.position = CGPoint(x: x, y: size.height + 40)
        asteroid.zPosition = 5

        let body = SKPhysicsBody(circleOfRadius: asteroid.fontSize * 0.35)
        body.categoryBitMask = Category.asteroid
        body.contactTestBitMask = Category.ship
        body.collisionBitMask = 0
        body.isDynamic = true
        asteroid.physicsBody = body

        addChild(asteroid)

        let moveDown = SKAction.moveTo(y: -50, duration: asteroidSpeed)
        let spin = SKAction.rotate(byAngle: CGFloat.random(in: -3...3), duration: asteroidSpeed)
        let group = SKAction.group([moveDown, spin])
        asteroid.run(.sequence([group, .removeFromParent()]))
    }

    private func spawnStar() {
        let star = SKLabelNode(text: "\u{2B50}")
        star.fontSize = 28
        star.name = "star"

        let margin: CGFloat = 30
        let x = CGFloat.random(in: margin...(size.width - margin))
        star.position = CGPoint(x: x, y: size.height + 30)
        star.zPosition = 5

        let body = SKPhysicsBody(circleOfRadius: 12)
        body.categoryBitMask = Category.star
        body.contactTestBitMask = Category.ship
        body.collisionBitMask = 0
        body.isDynamic = true
        star.physicsBody = body

        addChild(star)

        let moveDown = SKAction.moveTo(y: -40, duration: asteroidSpeed + 1)
        let pulse = SKAction.sequence([
            SKAction.scale(to: 1.2, duration: 0.4),
            SKAction.scale(to: 0.9, duration: 0.4)
        ])
        let group = SKAction.group([moveDown, .repeatForever(pulse)])
        star.run(.sequence([group, .removeFromParent()]))
    }

    private func spawnPowerup() {
        let powerup = SKLabelNode(text: "\u{1F6E1}\u{FE0F}")
        powerup.fontSize = 32
        powerup.name = "powerup"

        let margin: CGFloat = 30
        let x = CGFloat.random(in: margin...(size.width - margin))
        powerup.position = CGPoint(x: x, y: size.height + 30)
        powerup.zPosition = 5

        let body = SKPhysicsBody(circleOfRadius: 14)
        body.categoryBitMask = Category.powerup
        body.contactTestBitMask = Category.ship
        body.collisionBitMask = 0
        body.isDynamic = true
        powerup.physicsBody = body

        addChild(powerup)

        let moveDown = SKAction.moveTo(y: -40, duration: asteroidSpeed + 1)
        powerup.run(.sequence([moveDown, .removeFromParent()]))
    }

    private func increaseDifficulty() {
        if spawnInterval > 0.4 {
            spawnInterval -= 0.05
        }
        if asteroidSpeed > 2.0 {
            asteroidSpeed -= 0.1
        }

        // Restart spawning with new interval
        removeAction(forKey: "spawning")
        let spawnAction = SKAction.run { [weak self] in
            self?.spawnObstacle()
        }
        let wait = SKAction.wait(forDuration: spawnInterval, withRange: 0.3)
        run(.repeatForever(.sequence([spawnAction, wait])), withKey: "spawning")
    }

    // MARK: - Score

    private func startScoreTimer() {
        let scoreAction = SKAction.run { [weak self] in
            guard let self = self, !self.isGameOver else { return }
            self.score += 1
            self.scoreLabel.text = "Score: \(self.score)"
        }
        let wait = SKAction.wait(forDuration: 0.5)
        run(.repeatForever(.sequence([wait, scoreAction])), withKey: "scoreTimer")
    }

    // MARK: - Touch Handling

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let touch = touches.first, !isGameOver else { return }
        lastTouchPosition = touch.location(in: self)
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let touch = touches.first, !isGameOver else { return }
        let location = touch.location(in: self)

        if let lastPosition = lastTouchPosition {
            let dx = location.x - lastPosition.x
            let dy = location.y - lastPosition.y

            var newX = ship.position.x + dx
            var newY = ship.position.y + dy

            // Keep ship in bounds
            let margin: CGFloat = 20
            newX = max(margin, min(size.width - margin, newX))
            newY = max(margin, min(size.height - 60, newY))

            ship.position = CGPoint(x: newX, y: newY)
        }

        lastTouchPosition = location
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
        lastTouchPosition = nil
    }

    // MARK: - Physics Contact

    func didBegin(_ contact: SKPhysicsContact) {
        guard !isGameOver else { return }

        let collision = contact.bodyA.categoryBitMask | contact.bodyB.categoryBitMask

        if collision == Category.ship | Category.asteroid {
            let asteroidNode = contact.bodyA.categoryBitMask == Category.asteroid
                ? contact.bodyA.node : contact.bodyB.node
            handleAsteroidHit(asteroid: asteroidNode)
        } else if collision == Category.ship | Category.star {
            let starNode = contact.bodyA.categoryBitMask == Category.star
                ? contact.bodyA.node : contact.bodyB.node
            handleStarCollected(star: starNode)
        } else if collision == Category.ship | Category.powerup {
            let powerupNode = contact.bodyA.categoryBitMask == Category.powerup
                ? contact.bodyA.node : contact.bodyB.node
            handlePowerupCollected(powerup: powerupNode)
        }
    }

    private func handleAsteroidHit(asteroid: SKNode?) {
        guard !isInvincible else {
            // Destroy the asteroid if shielded
            if let asteroid = asteroid {
                showExplosion(at: asteroid.position)
                asteroid.removeFromParent()
            }
            return
        }

        asteroid?.removeFromParent()

        lives -= 1
        updateLivesDisplay()

        // Flash the ship
        let flash = SKAction.sequence([
            SKAction.fadeAlpha(to: 0.2, duration: 0.1),
            SKAction.fadeAlpha(to: 1.0, duration: 0.1)
        ])
        ship.run(.repeat(flash, count: 5))

        // Brief invincibility after hit
        isInvincible = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
            self?.isInvincible = false
        }

        // Screen shake
        let shake = SKAction.sequence([
            SKAction.moveBy(x: 5, y: 0, duration: 0.05),
            SKAction.moveBy(x: -10, y: 0, duration: 0.05),
            SKAction.moveBy(x: 5, y: 0, duration: 0.05),
        ])
        scene?.run(shake)

        if lives <= 0 {
            gameOver()
        }
    }

    private func handleStarCollected(star: SKNode?) {
        guard let starNode = star else { return }
        let pos = starNode.position
        starNode.removeFromParent()

        score += 25
        scoreLabel.text = "Score: \(score)"

        // Float up score text
        let bonus = SKLabelNode(fontNamed: "AvenirNext-Bold")
        bonus.text = "+25"
        bonus.fontSize = 18
        bonus.fontColor = SKColor(red: 1.0, green: 0.85, blue: 0.3, alpha: 1.0)
        bonus.position = pos
        bonus.zPosition = 50
        addChild(bonus)

        let fadeUp = SKAction.group([
            SKAction.moveBy(x: 0, y: 40, duration: 0.6),
            SKAction.fadeOut(withDuration: 0.6)
        ])
        bonus.run(.sequence([fadeUp, .removeFromParent()]))
    }

    private func handlePowerupCollected(powerup: SKNode?) {
        guard let node = powerup else { return }
        node.removeFromParent()

        // Grant shield (invincibility for 5 seconds)
        isInvincible = true

        // Visual shield effect
        let shield = SKShapeNode(circleOfRadius: 28)
        shield.strokeColor = SKColor(red: 0.3, green: 0.8, blue: 1.0, alpha: 0.8)
        shield.fillColor = SKColor(red: 0.3, green: 0.8, blue: 1.0, alpha: 0.15)
        shield.lineWidth = 2
        shield.name = "shield"
        shield.zPosition = 11
        ship.addChild(shield)

        let pulse = SKAction.sequence([
            SKAction.scale(to: 1.15, duration: 0.5),
            SKAction.scale(to: 1.0, duration: 0.5)
        ])
        shield.run(.repeatForever(pulse))

        // Remove shield after 5 seconds
        DispatchQueue.main.asyncAfter(deadline: .now() + 5.0) { [weak self] in
            self?.isInvincible = false
            self?.ship.childNode(withName: "shield")?.removeFromParent()
        }

        // Show "+SHIELD" text
        let label = SKLabelNode(fontNamed: "AvenirNext-Bold")
        label.text = "SHIELD!"
        label.fontSize = 20
        label.fontColor = SKColor(red: 0.3, green: 0.8, blue: 1.0, alpha: 1.0)
        label.position = CGPoint(x: ship.position.x, y: ship.position.y + 40)
        label.zPosition = 50
        addChild(label)

        let fadeUp = SKAction.group([
            SKAction.moveBy(x: 0, y: 40, duration: 0.8),
            SKAction.fadeOut(withDuration: 0.8)
        ])
        label.run(.sequence([fadeUp, .removeFromParent()]))
    }

    private func showExplosion(at position: CGPoint) {
        let explosion = SKLabelNode(text: "\u{1F4A5}")
        explosion.fontSize = 40
        explosion.position = position
        explosion.zPosition = 20
        addChild(explosion)

        let animate = SKAction.group([
            SKAction.scale(to: 1.5, duration: 0.3),
            SKAction.fadeOut(withDuration: 0.3)
        ])
        explosion.run(.sequence([animate, .removeFromParent()]))
    }

    // MARK: - Game Over

    private func gameOver() {
        isGameOver = true

        removeAction(forKey: "spawning")
        removeAction(forKey: "starSpawning")
        removeAction(forKey: "powerupSpawning")
        removeAction(forKey: "scoreTimer")
        removeAction(forKey: "difficulty")

        // Explosion at ship
        showExplosion(at: ship.position)
        ship.removeFromParent()

        // Save high score
        let highScore = UserDefaults.standard.integer(forKey: "highScore")
        if score > highScore {
            UserDefaults.standard.set(score, forKey: "highScore")
        }

        // Transition to game over scene after brief delay
        let wait = SKAction.wait(forDuration: 1.0)
        let transition = SKAction.run { [weak self] in
            guard let self = self else { return }
            let gameOverScene = GameOverScene(size: self.size)
            gameOverScene.finalScore = self.score
            gameOverScene.isNewHighScore = self.score > highScore
            gameOverScene.scaleMode = .aspectFill
            self.view?.presentScene(gameOverScene, transition: .fade(withDuration: 0.5))
        }
        run(.sequence([wait, transition]))
    }
}
