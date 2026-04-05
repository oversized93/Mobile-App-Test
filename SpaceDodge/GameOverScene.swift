import SpriteKit

class GameOverScene: SKScene {

    var finalScore: Int = 0
    var isNewHighScore: Bool = false

    override func didMove(to view: SKView) {
        backgroundColor = SKColor(red: 0.05, green: 0.02, blue: 0.15, alpha: 1.0)

        createStarfield()
        createContent()
    }

    private func createStarfield() {
        let emitter = SKEmitterNode()
        emitter.particleBirthRate = 6
        emitter.particleLifetime = 14
        emitter.particlePositionRange = CGVector(dx: size.width, dy: 0)
        emitter.emissionAngle = .pi * 1.5
        emitter.particleSpeed = 30
        emitter.particleAlpha = 0.6
        emitter.particleScale = 0.04
        emitter.particleScaleRange = 0.02
        emitter.particleColor = .white
        emitter.particleColorBlendFactor = 1.0
        emitter.particleBlendMode = .add
        emitter.position = CGPoint(x: size.width / 2, y: size.height)
        emitter.advanceSimulationTime(10)
        emitter.zPosition = -1
        addChild(emitter)
    }

    private func createContent() {
        // Game Over title
        let title = SKLabelNode(fontNamed: "AvenirNext-Bold")
        title.text = "GAME OVER"
        title.fontSize = 42
        title.fontColor = SKColor(red: 1.0, green: 0.3, blue: 0.3, alpha: 1.0)
        title.position = CGPoint(x: size.width / 2, y: size.height * 0.7)
        addChild(title)

        // Explosion emoji
        let explosion = SKLabelNode(text: "\u{1F4A5}")
        explosion.fontSize = 60
        explosion.position = CGPoint(x: size.width / 2, y: size.height * 0.58)
        addChild(explosion)

        // Score
        let scoreLabel = SKLabelNode(fontNamed: "AvenirNext-Bold")
        scoreLabel.text = "Score: \(finalScore)"
        scoreLabel.fontSize = 30
        scoreLabel.fontColor = .white
        scoreLabel.position = CGPoint(x: size.width / 2, y: size.height * 0.46)
        addChild(scoreLabel)

        // High score
        if isNewHighScore {
            let newHighLabel = SKLabelNode(fontNamed: "AvenirNext-Bold")
            newHighLabel.text = "NEW HIGH SCORE!"
            newHighLabel.fontSize = 22
            newHighLabel.fontColor = SKColor(red: 1.0, green: 0.85, blue: 0.3, alpha: 1.0)
            newHighLabel.position = CGPoint(x: size.width / 2, y: size.height * 0.40)
            addChild(newHighLabel)

            let pulse = SKAction.sequence([
                SKAction.scale(to: 1.1, duration: 0.5),
                SKAction.scale(to: 1.0, duration: 0.5)
            ])
            newHighLabel.run(.repeatForever(pulse))
        } else {
            let highScore = UserDefaults.standard.integer(forKey: "highScore")
            let bestLabel = SKLabelNode(fontNamed: "AvenirNext-Medium")
            bestLabel.text = "Best: \(highScore)"
            bestLabel.fontSize = 20
            bestLabel.fontColor = SKColor(red: 0.7, green: 0.7, blue: 0.9, alpha: 1.0)
            bestLabel.position = CGPoint(x: size.width / 2, y: size.height * 0.40)
            addChild(bestLabel)
        }

        // Play Again button
        let button = SKShapeNode(rectOf: CGSize(width: 220, height: 55), cornerRadius: 27)
        button.fillColor = SKColor(red: 0.2, green: 0.6, blue: 1.0, alpha: 1.0)
        button.strokeColor = SKColor(red: 0.4, green: 0.8, blue: 1.0, alpha: 1.0)
        button.lineWidth = 2
        button.position = CGPoint(x: size.width / 2, y: size.height * 0.25)
        button.name = "playAgain"
        addChild(button)

        let buttonLabel = SKLabelNode(fontNamed: "AvenirNext-Bold")
        buttonLabel.text = "PLAY AGAIN"
        buttonLabel.fontSize = 22
        buttonLabel.fontColor = .white
        buttonLabel.verticalAlignmentMode = .center
        buttonLabel.name = "playAgain"
        button.addChild(buttonLabel)

        // Menu button
        let menuButton = SKShapeNode(rectOf: CGSize(width: 220, height: 55), cornerRadius: 27)
        menuButton.fillColor = SKColor(red: 0.3, green: 0.3, blue: 0.4, alpha: 1.0)
        menuButton.strokeColor = SKColor(red: 0.5, green: 0.5, blue: 0.6, alpha: 1.0)
        menuButton.lineWidth = 2
        menuButton.position = CGPoint(x: size.width / 2, y: size.height * 0.15)
        menuButton.name = "menu"
        addChild(menuButton)

        let menuLabel = SKLabelNode(fontNamed: "AvenirNext-Bold")
        menuLabel.text = "MENU"
        menuLabel.fontSize = 22
        menuLabel.fontColor = .white
        menuLabel.verticalAlignmentMode = .center
        menuLabel.name = "menu"
        menuButton.addChild(menuLabel)
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
        guard let touch = touches.first else { return }
        let location = touch.location(in: self)
        let nodes = self.nodes(at: location)

        if nodes.contains(where: { $0.name == "playAgain" }) {
            let gameScene = GameScene(size: size)
            gameScene.scaleMode = .aspectFill
            view?.presentScene(gameScene, transition: .fade(withDuration: 0.5))
        } else if nodes.contains(where: { $0.name == "menu" }) {
            let menuScene = MenuScene(size: size)
            menuScene.scaleMode = .aspectFill
            view?.presentScene(menuScene, transition: .fade(withDuration: 0.5))
        }
    }
}
