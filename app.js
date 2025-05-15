// BeamNG Spotify Radio Integration
// Connects BeamNG.drive with Spotify for in-game music with spatial audio

angular.module('beamng.apps')
.directive('spotifyRadio', ['$timeout', function ($timeout) {
  return {
    templateUrl: '/ui/modules/apps/spotify_radio/app.html',
    replace: true,
    restrict: 'EA',
    scope: true,
    controller: ['$scope', function ($scope) {
      // Spotify API configuration
      // Client ID will be retrieved from the server
      const REDIRECT_URI = 'https://colossal-scarlet-brake.glitch.me/callback'; // Redirects back to our local server
      const SPOTIFY_AUTH_URL = 'https://accounts.spotify.com/authorize';
      const SPOTIFY_API_URL = 'https://api.spotify.com/v1';
      const SCOPES = [
        'user-read-private',
        'user-read-email',
        'user-read-playback-state',
        'user-modify-playback-state',
        'user-read-currently-playing',
        'streaming'
      ];

      // Audio context for spatial audio processing
      let audioContext = null;
      let spotifyPlayer = null;
      let audioNodes = {};
      let currentTrack = null;
      let progressInterval = null;
      let isPlaying = false;
      let isConnected = false;
      let volume = 0.8;
      let audioPositions = [];
      let spatialAudioEnabled = true;
      
      // Vehicle state
      let engineRunning = false;
      let ignitionOn = false;
      let cameraInside = true;
      
      // Initialize the application
      $scope.init = function() {
        $scope.showLoginSection();
        $scope.setupEventListeners();
        $scope.checkAuthToken();
        $scope.sendMessageToGame({ type: 'requestVehicleInfo' });
        
        // Initialize Web Audio API for spatial audio processing
        initAudioContext();
      };
      
      // Set up UI event listeners
      $scope.setupEventListeners = function() {
        document.getElementById('loginButton').addEventListener('click', $scope.authenticate);
        document.getElementById('logoutButton').addEventListener('click', $scope.logout);
        document.getElementById('playPauseButton').addEventListener('click', $scope.togglePlayback);
        document.getElementById('prevButton').addEventListener('click', $scope.previousTrack);
        document.getElementById('nextButton').addEventListener('click', $scope.nextTrack);
        document.getElementById('volumeSlider').addEventListener('input', $scope.updateVolume);
        document.getElementById('spatialToggle').addEventListener('change', $scope.toggleSpatialAudio);
      };
      
      // Show login section
      $scope.showLoginSection = function() {
        document.getElementById('loginSection').style.display = 'flex';
        document.getElementById('playerSection').style.display = 'none';
      };
      
      // Show player section
      $scope.showPlayerSection = function() {
        document.getElementById('loginSection').style.display = 'none';
        document.getElementById('playerSection').style.display = 'flex';
      };
      
      // Check if we have a valid auth token
      $scope.checkAuthToken = function() {
        const token = localStorage.getItem('spotify_token');
        const expiry = localStorage.getItem('spotify_token_expiry');
        
        if (token && expiry && parseInt(expiry, 10) > Date.now()) {
          $scope.initializeWithToken(token);
        } else {
          // Check if we have a token in the URL (from redirect)
          const hash = window.location.hash.substring(1);
          const params = new URLSearchParams(hash);
          
          if (params.has('access_token')) {
            const token = params.get('access_token');
            const expiresIn = params.get('expires_in');
            const expiry = Date.now() + (parseInt(expiresIn, 10) * 1000);
            
            localStorage.setItem('spotify_token', token);
            localStorage.setItem('spotify_token_expiry', expiry);
            
            // Clear the URL hash
            window.history.replaceState(null, null, ' ');
            
            $scope.initializeWithToken(token);
          }
        }
      };
      
      // Initialize Spotify Web Playback SDK with the token
      $scope.initializeWithToken = function(token) {
        // Load Spotify Web Playback SDK script
        const script = document.createElement('script');
        script.src = 'https://sdk.scdn.co/spotify-player.js';
        script.async = true;
        document.body.appendChild(script);
        
        // Wait for Spotify SDK to load
        window.onSpotifyWebPlaybackSDKReady = () => {
          spotifyPlayer = new Spotify.Player({
            name: 'BeamNG.drive Car Radio',
            getOAuthToken: cb => cb(token)
          });
          
          // Error handling
          spotifyPlayer.addListener('initialization_error', ({ message }) => {
            console.error('Spotify initialization error:', message);
            $scope.updateConnectionStatus('Connection Error');
          });
          
          spotifyPlayer.addListener('authentication_error', ({ message }) => {
            console.error('Spotify authentication error:', message);
            $scope.updateConnectionStatus('Authentication Error');
            $scope.logout();
          });
          
          spotifyPlayer.addListener('account_error', ({ message }) => {
            console.error('Spotify account error:', message);
            $scope.updateConnectionStatus('Account Error');
          });
          
          spotifyPlayer.addListener('playback_error', ({ message }) => {
            console.error('Spotify playback error:', message);
          });
          
          // Playback status updates
          spotifyPlayer.addListener('player_state_changed', state => {
            if (state) {
              $scope.updatePlayerState(state);
            }
          });
          
          // Ready
          spotifyPlayer.addListener('ready', ({ device_id }) => {
            console.log('Ready with Device ID', device_id);
            localStorage.setItem('spotify_device_id', device_id);
            $scope.updateConnectionStatus('Connected');
            isConnected = true;
            $scope.showPlayerSection();
            $scope.transferPlayback(device_id);
            
            // Apply state in Angular context
            $timeout(() => {
              $scope.$apply();
            });
          });
          
          // Disconnected
          spotifyPlayer.addListener('not_ready', ({ device_id }) => {
            console.log('Device ID has gone offline', device_id);
            $scope.updateConnectionStatus('Disconnected');
            isConnected = false;
            
            // Apply state in Angular context
            $timeout(() => {
              $scope.$apply();
            });
          });
          
          // Connect to the player
          spotifyPlayer.connect();
        };
        
        // Get user info for display
        $scope.fetchUserProfile(token);
      };
      
      // Authenticate with Spotify
$scope.authenticate = function() {
  const authUrl = 'https://colossal-scarlet-brake.glitch.me/login';
  
  // Versuche BeamNG API zuerst
  try {
    if (typeof bngApi !== 'undefined' && bngApi.openBrowser) {
      bngApi.openBrowser(authUrl);
    } else {
      // Fallback: Standard-Popup
      const authWindow = window.open(authUrl, 'spotify-auth', 'width=800,height=600');
      
      // Polling für Popup-Status
      const popupCheck = setInterval(() => {
        if (authWindow.closed) {
          clearInterval(popupCheck);
          $scope.checkAuthToken();
        }
      }, 500);
    }
  } catch (e) {
    console.error('Auth failed:', e);
  }
};


  // Event-Listener für die Token-Übergabe
window.addEventListener('message', (event) => {
  if (event.origin !== 'https://colossal-scarlet-brake.glitch.me') return;
  
  if (event.data.type === 'spotify-auth-success') {
    const token = event.data.token;
    localStorage.setItem('spotify_token', token);
    $scope.initializeWithToken(token);
  } else if (event.data.type === 'spotify-auth-error') {
    console.error('Auth error:', event.data.error);
  }
});
      
      // Logout from Spotify
      $scope.logout = function() {
        if (spotifyPlayer) {
          spotifyPlayer.disconnect();
        }
        
        localStorage.removeItem('spotify_token');
        localStorage.removeItem('spotify_token_expiry');
        localStorage.removeItem('spotify_device_id');
        
        isConnected = false;
        $scope.updateConnectionStatus('Disconnected');
        $scope.showLoginSection();
        
        // Clear the player state
        clearInterval(progressInterval);
      };
      
      // Update the connection status indicator
      $scope.updateConnectionStatus = function(status) {
        const statusElement = document.getElementById('connectionStatus');
        if (statusElement) {
          statusElement.innerText = status;
          
          // Apply a color based on status
          if (status === 'Connected') {
            statusElement.style.backgroundColor = 'rgba(0, 0, 0, 0.3)';
          } else {
            statusElement.style.backgroundColor = 'rgba(255, 0, 0, 0.3)';
          }
        }
      };
      
      // Fetch user profile information
      $scope.fetchUserProfile = function(token) {
        fetch(`${SPOTIFY_API_URL}/me`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        })
        .then(response => {
          if (!response.ok) {
            throw new Error('Failed to fetch user profile');
          }
          return response.json();
        })
        .then(data => {
          console.log('User profile:', data);
          // Could display user name or avatar if desired
        })
        .catch(error => {
          console.error('Error fetching user profile:', error);
        });
      };
      
      // Transfer playback to our device
      $scope.transferPlayback = function(deviceId) {
        const token = localStorage.getItem('spotify_token');
        
        fetch(`${SPOTIFY_API_URL}/me/player`, {
          method: 'PUT',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            device_ids: [deviceId],
            play: false
          })
        })
        .then(response => {
          if (!response.ok && response.status !== 204) {
            throw new Error('Failed to transfer playback');
          }
          console.log('Playback transferred to BeamNG device');
        })
        .catch(error => {
          console.error('Error transferring playback:', error);
        });
      };
      
      // Update the player state based on Spotify data
      $scope.updatePlayerState = function(state) {
        // Update track information
        currentTrack = state.track_window.current_track;
        
        // Update UI elements
        $timeout(() => {
          document.getElementById('trackName').innerText = currentTrack.name;
          document.getElementById('artistName').innerText = currentTrack.artists.map(a => a.name).join(', ');
          
          // Update play/pause button
          const playIcon = document.getElementById('playIcon');
          const pauseIcon = document.getElementById('pauseIcon');
          
          if (state.paused) {
            playIcon.style.display = 'block';
            pauseIcon.style.display = 'none';
            isPlaying = false;
          } else {
            playIcon.style.display = 'none';
            pauseIcon.style.display = 'block';
            isPlaying = true;
          }
          
          // Update progress bar
          updateProgress(state.position, state.duration);
          
          // Setup progress tracking
          clearInterval(progressInterval);
          
          if (!state.paused) {
            let currentPosition = state.position;
            progressInterval = setInterval(() => {
              currentPosition += 1000; // Add 1 second
              if (currentPosition < state.duration) {
                updateProgress(currentPosition, state.duration);
              } else {
                clearInterval(progressInterval);
              }
            }, 1000);
          }
          
          // Notify the game about playback state change
          $scope.sendMessageToGame({
            type: 'playbackStateChanged',
            isPlaying: !state.paused
          });
        });
      };
      
      // Update progress bar and time display
      function updateProgress(position, duration) {
        const progressFill = document.getElementById('progressFill');
        const progressTime = document.getElementById('progressTime');
        const durationTime = document.getElementById('durationTime');
        
        // Calculate percentage
        const percentage = (position / duration) * 100;
        progressFill.style.width = `${percentage}%`;
        
        // Update time displays
        progressTime.innerText = formatTime(position);
        durationTime.innerText = formatTime(duration);
      }
      
      // Format milliseconds to mm:ss format
      function formatTime(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
      }
      
      // Toggle playback (play/pause)
      $scope.togglePlayback = function() {
        if (!spotifyPlayer) return;
        
        if (!engineRunning && !ignitionOn) {
          alert('Cannot play music when engine is off and ignition is off');
          return;
        }
        
        spotifyPlayer.togglePlay();
      };
      
      // Skip to previous track
      $scope.previousTrack = function() {
        if (!spotifyPlayer) return;
        spotifyPlayer.previousTrack();
      };
      
      // Skip to next track
      $scope.nextTrack = function() {
        if (!spotifyPlayer) return;
        spotifyPlayer.nextTrack();
      };
      
      // Update volume level
      $scope.updateVolume = function(event) {
        const newVolume = event.target.value / 100;
        volume = newVolume;
        
        if (spotifyPlayer) {
          spotifyPlayer.setVolume(newVolume);
        }
        
        // Update audio gain for spatial audio
        if (audioContext && audioNodes.gainNode) {
          // Apply inside/outside dampening if needed
          if (!cameraInside) {
            audioNodes.gainNode.gain.value = newVolume * 0.3; // Reduce when outside
          } else {
            audioNodes.gainNode.gain.value = newVolume;
          }
        }
        
        // Notify the game
        $scope.sendMessageToGame({
          type: 'volumeChanged',
          volume: newVolume
        });
      };
      
      // Toggle spatial audio effect
      $scope.toggleSpatialAudio = function(event) {
        spatialAudioEnabled = event.target.checked;
        
        if (audioContext && audioNodes.pannerNodes) {
          // Enable/disable spatial audio effects
          Object.values(audioNodes.pannerNodes).forEach(panner => {
            if (spatialAudioEnabled) {
              // Re-enable spatial effects
              panner.distanceModel = 'inverse';
              panner.rolloffFactor = 2;
            } else {
              // Disable spatial effects (make sound always the same volume regardless of position)
              panner.distanceModel = 'linear';
              panner.rolloffFactor = 0;
            }
          });
        }
      };
      
      // Initialize Web Audio API for spatial audio processing
      function initAudioContext() {
        try {
          audioContext = new (window.AudioContext || window.webkitAudioContext)();
          audioNodes = {
            gainNode: audioContext.createGain(),
            splitterNode: audioContext.createChannelSplitter(2),
            mergerNode: audioContext.createChannelMerger(2),
            pannerNodes: {}  // Will hold multiple panner nodes for different positions
          };
          
          // Set up initial gain (volume)
          audioNodes.gainNode.gain.value = volume;
          
          console.log('Audio context initialized for spatial audio');
        } catch (error) {
          console.error('Could not initialize Web Audio API:', error);
        }
      }
      
      // Set up spatial audio routing for multiple speaker positions
      function setupSpatialAudio() {
        if (!audioContext || !spotifyPlayer) return;
        
        try {
          // Get the audio element that Spotify Web Playback SDK is using
          const spotifyAudioEl = document.querySelector('audio[src^="blob:"]');
          
          if (!spotifyAudioEl) {
            console.warn('Could not find Spotify audio element');
            return;
          }
          
          // Create a media element source from the Spotify audio element
          const source = audioContext.createMediaElementSource(spotifyAudioEl);
          
          // Connect to the main gain node
          source.connect(audioNodes.splitterNode);
          audioNodes.splitterNode.connect(audioNodes.gainNode);
          
          // Create a panner node for each door position
          audioPositions.forEach((position, index) => {
            const pannerNode = audioContext.createPanner();
            
            // Configure the panner node
            pannerNode.panningModel = 'HRTF';  // Head-related transfer function for more realistic 3D
            pannerNode.distanceModel = 'inverse';
            pannerNode.refDistance = 1;
            pannerNode.maxDistance = 10;
            pannerNode.rolloffFactor = 2;
            pannerNode.coneInnerAngle = 360;
            pannerNode.coneOuterAngle = 360;
            pannerNode.coneOuterGain = 0.8;
            
            // Position the panner in 3D space
            pannerNode.positionX.value = position.x;
            pannerNode.positionY.value = position.y;
            pannerNode.positionZ.value = position.z;
            
            // Store the panner node
            audioNodes.pannerNodes[position.name] = pannerNode;
            
            // Connect splitter to this panner (either left or right channel)
            // Left speakers on the left side, right speakers on the right side
            if (position.name.includes('left') || position.name.includes('Left')) {
              audioNodes.splitterNode.connect(pannerNode, 0);  // Left channel
            } else {
              audioNodes.splitterNode.connect(pannerNode, 1);  // Right channel
            }
            
            // Connect the panner to the merger
            pannerNode.connect(audioNodes.mergerNode);
          });
          
          // Connect the merger to the audio output
          audioNodes.mergerNode.connect(audioContext.destination);
          
          console.log('Spatial audio routing configured');
        } catch (error) {
          console.error('Error setting up spatial audio:', error);
        }
      }
      
      // Update panner positions based on door positions from the game
      function updateAudioPositions(positions) {
        audioPositions = positions;
        
        // Update panner positions if they exist
        if (audioContext && audioNodes.pannerNodes) {
          positions.forEach(position => {
            const panner = audioNodes.pannerNodes[position.name];
            if (panner) {
              panner.positionX.value = position.x;
              panner.positionY.value = position.y;
              panner.positionZ.value = position.z;
            }
          });
        } else {
          // If audio routing isn't set up yet, do it now
          setupSpatialAudio();
        }
      }
      
      // Update listener position (camera position in the game)
      function updateListenerPosition(position, rotation) {
        if (!audioContext) return;
        
        // Set listener position (camera position)
        audioContext.listener.positionX.value = position.x;
        audioContext.listener.positionY.value = position.y;
        audioContext.listener.positionZ.value = position.z;
        
        // Set listener orientation based on camera rotation
        // forward vector
        audioContext.listener.forwardX.value = Math.sin(rotation.y);
        audioContext.listener.forwardY.value = 0;
        audioContext.listener.forwardZ.value = Math.cos(rotation.y);
        
        // up vector
        audioContext.listener.upX.value = 0;
        audioContext.listener.upY.value = 1;
        audioContext.listener.upZ.value = 0;
      }
      
      // Update playback based on engine state
      function updatePlaybackState(data) {
        engineRunning = data.engineRunning;
        ignitionOn = data.ignitionOn;
        
        // Update UI indicators
        document.getElementById('engineStatus').innerText = engineRunning ? 'Running' : 'Off';
        document.getElementById('ignitionStatus').innerText = ignitionOn ? 'On' : 'Off';
        
        // If engine and ignition both off, pause playback
        if (!engineRunning && !ignitionOn && isPlaying && spotifyPlayer) {
          spotifyPlayer.pause();
        }
      }
      
      // Update audio settings based on camera position
      function updateAudioSettings(data) {
        cameraInside = data.isInside;
        
        // Update UI indicator
        document.getElementById('cameraStatus').innerText = cameraInside ? 'Inside' : 'Outside';
        
        // Adjust volume based on camera position
        if (audioContext && audioNodes.gainNode) {
          if (cameraInside) {
            audioNodes.gainNode.gain.value = volume;
          } else {
            audioNodes.gainNode.gain.value = volume * 0.3; // Reduce volume when outside
          }
        }
      }
      
      // Handle communication from the Lua game extension
      $scope.handleGameMessage = function(data) {
        $timeout(() => {
          switch (data.type) {
            case 'vehicleInfo':
              updatePlaybackState(data);
              break;
              
            case 'setPlaybackState':
              updatePlaybackState(data);
              break;
              
            case 'audioPositions':
              updateAudioPositions(data.positions);
              break;
              
            case 'updateAudioSettings':
              updateAudioSettings(data);
              break;
              
            case 'cameraPosition':
              updateListenerPosition(data.position, data.rotation);
              break;
          }
        });
      };
      
      // Send a message to the Lua game extension
      $scope.sendMessageToGame = function(message) {
        bngApi.activeObjectLua('extensions.spotify_radio.handleUIMessage', message);
      };
      
      // BeamNG callbacks
      $scope.$on('VehicleChange', (event, data) => {
        // Request vehicle info when vehicle changes
        $scope.sendMessageToGame({ type: 'requestVehicleInfo' });
      });
      
      // Initialize the app
      $timeout(() => {
        $scope.init();
      });
    }]
  };
}]);
